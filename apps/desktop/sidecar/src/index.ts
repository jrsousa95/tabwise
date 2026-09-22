import http from "node:http";
import path from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { DomainEventSchema, OperatorRoleSchema, PinSchema, CancelReasonSchema } from "@passa-a-regua/shared-types";
import {
  openDatabase,
  insertEvent,
  insertEvents,
  listEventsSinceCursor,
  findEventsByAggregateId,
  project,
  sortEvents,
  hashPin,
  verifyPin,
  localDateKey,
  computeCashRegisterSummary,
} from "@passa-a-regua/sync-engine";
import { nextHlc } from "./clock.js";
import { loadOrCreateTerminalId } from "./terminal-identity.js";
import { loadSession, saveSession, clearSession } from "./session.js";
import { loadOrCreateLanToken, adoptLanToken } from "./lan-pairing.js";
import { startDiscovery, stopDiscovery } from "./discovery.js";
import { loadManualHost, saveManualHost, clearManualHost } from "./manual-host.js";
import { startLanSyncLoop } from "./lan-sync-client.js";
import { startCloudSyncLoop, BACKEND_URL } from "./cloud-sync-client.js";
import { loadCloudCredential } from "./cloud-credential.js";
import { loadPlanCache } from "./plan-cache.js";
import { loadRegistrationError } from "./registration-status.js";

/**
 * M2 (ARCH §9, implementation-plan.md): sidecar real conectado ao
 * sync-engine — abre o SQLite local no start e expõe uma API HTTP mínima
 * pro frontend escrever/ler eventos. M3 (PRD Épico 1): autenticação de
 * operador por PIN e sessão de terminal.
 */

// Override só pra rodar mais de um sidecar na mesma máquina (teste manual,
// e mais pra frente M9 com múltiplos terminais simulados localmente).
const PORT = Number(process.env.PASSA_A_REGUA_PORT) || 4550;
const startedAt = new Date().toISOString();

/**
 * O Tauri passa o diretório de dados do app via env var (ver
 * `src-tauri/src/lib.rs`) — é onde o SQLite deve morar de verdade. Fora do
 * Tauri (ex: rodando o sidecar direto em dev), cai num caminho local.
 */
const dataDir = process.env.PASSA_A_REGUA_DATA_DIR ?? path.join(process.cwd(), ".dev-data");
mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "passa-a-regua.db");
const db = openDatabase(dbPath);
const terminalId = loadOrCreateTerminalId(dataDir);

// M9 (ARCH §2, §5, §7): descoberta mDNS + sync LAN e sync com a nuvem
// rodando em paralelo, cada um no seu próprio ciclo independente — queda de
// um não trava o outro.
loadOrCreateLanToken(dataDir); // garante que o token existe desde o boot (tela de Pareamento só lê depois)
startDiscovery(terminalId, PORT);
const stopLanSync = startLanSyncLoop(db, dataDir);
const stopCloudSync = startCloudSyncLoop(db, dataDir, terminalId);

function currentState() {
  return project(sortEvents(listEventsSinceCursor(db)));
}

function currentOperators() {
  return currentState().operators;
}

/** Qualquer operação que precise saber "quem está fazendo isso" (fora do bootstrap de `POST /operators`). */
function requireSession(res: http.ServerResponse) {
  const session = loadSession(dataDir);
  const acting = currentOperators().find((o) => o.id === session?.operatorId);
  if (!acting) {
    sendJson(res, 401, { error: "faça login primeiro" });
    return null;
  }
  return acting;
}

/** PRD 3.1/3.2/2.1 — só o dono cadastra categoria/produto/mesa. */
function requireOwner(res: http.ServerResponse) {
  const acting = requireSession(res);
  if (!acting) return null;
  if (acting.role !== "owner") {
    sendJson(res, 403, { error: "só o dono pode fazer isso" });
    return null;
  }
  return acting;
}

/**
 * M9 (ARCH §7) — pareamento tem uma exceção de bootstrap igual à de
 * `POST /operators`: um terminal novo não tem NENHUM operador até
 * sincronizar (os operadores chegam via sync, não são cadastrados de novo
 * em cada terminal). Sem essa exceção, um terminal novo nunca conseguiria
 * se parear — não tem quem logar como dono pra autorizar o pareamento que
 * é justamente o que traria os operadores. Depois que o terminal já tem
 * operadores (já se pareou uma vez, ou é o terminal original), volta a
 * exigir dono normalmente.
 */
function requireOwnerOrBootstrap(res: http.ServerResponse): boolean {
  if (currentOperators().length === 0) return true;
  return requireOwner(res) !== null;
}

/**
 * M9 (ARCH §7) — autentica requisições de OUTRO terminal no sync LAN (não
 * confundir com `requireSession`, que autentica o operador humano no
 * frontend local). Token compartilhado só entre terminais pareados —
 * qualquer outro dispositivo na rede Wi-Fi do bar é rejeitado.
 */
/**
 * M12 (ARCH §7, revisão de segurança) — comparação em tempo constante.
 * `!==` entre strings vaza timing (V8 costuma sair no primeiro byte
 * diferente), o que dá pra outro dispositivo na mesma rede Wi-Fi usar pra
 * adivinhar o token byte a byte; `timingSafeEqual` já era usado pro PIN
 * (`packages/sync-engine/src/auth.ts`) mas não tinha sido aplicado aqui.
 */
function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function requireLanToken(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token || !safeEquals(token, loadOrCreateLanToken(dataDir))) {
    sendJson(res, 401, { error: "token de pareamento LAN ausente ou inválido" });
    return false;
  }
  return true;
}

/** M10 (ARCH §6, PRD 2.7/8.2) — lê o cache local do plano (atualizado a cada sync com a nuvem, `cloud-sync-client.ts`); nunca chama a nuvem em tempo real aqui, precisa funcionar 100% offline (NFR1). */
function maxConcurrentOrders(): number {
  return loadPlanCache(dataDir).maxConcurrentOrders;
}

function isTableFree(state: ReturnType<typeof currentState>, tableId: string): boolean {
  return !state.orders.some((o) => o.mergedInto === undefined && o.status === "open" && o.currentTableId === tableId);
}

type Order = ReturnType<typeof currentState>["orders"][number];

/** PRD 5.1 — soma dos itens não cancelados; nunca confia num subtotal vindo do cliente. */
function computeSubtotalCents(order: Order): number {
  return order.items.filter((i) => !i.canceled).reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
}

/** PRD 5.2 — divisão em partes iguais: resto da divisão inteira vai determinística pra primeira parcela. */
function distributeEqually(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const result = new Array(parts).fill(base) as number[];
  result[0] += total - base * parts;
  return result;
}

type Payment = { amountCents: number; paymentMethod: "cash" | "card"; changeCents: number };

/**
 * PRD 5.2/5.3/5.4 — valida as partes do split (soma exata obrigatória, sem
 * tolerância) e calcula o troco de cada parte em dinheiro.
 */
function parseSplits(splitsInput: readonly unknown[], totalCents: number): { ok: true; payments: Payment[] } | { ok: false; error: string } {
  if (splitsInput.length === 0) return { ok: false, error: "informe ao menos uma parte do pagamento" };

  const payments: Payment[] = [];
  let sum = 0;
  for (const raw of splitsInput) {
    const split = raw as Record<string, unknown> | null;
    const amountCents = split?.amountCents;
    const paymentMethod = split?.paymentMethod;
    if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents <= 0) {
      return { ok: false, error: "cada parte do split precisa de um valor inteiro positivo" };
    }
    if (paymentMethod !== "cash" && paymentMethod !== "card") {
      return { ok: false, error: "forma de pagamento precisa ser 'cash' ou 'card'" };
    }
    let changeCents = 0;
    if (paymentMethod === "cash") {
      const cashReceivedCents = split?.cashReceivedCents;
      if (typeof cashReceivedCents !== "number" || !Number.isInteger(cashReceivedCents) || cashReceivedCents < amountCents) {
        return { ok: false, error: "valor recebido em dinheiro precisa ser maior ou igual ao valor da parte" };
      }
      // PRD 5.4 — troco só se aplica à parte em dinheiro.
      changeCents = cashReceivedCents - amountCents;
    }
    payments.push({ amountCents, paymentMethod, changeCents });
    sum += amountCents;
  }
  // PRD 5.2 — sem faixa de tolerância, a soma precisa bater exata.
  if (sum !== totalCents) {
    return { ok: false, error: `soma das partes (${sum}) precisa ser exatamente igual ao total (${totalCents})` };
  }
  return { ok: true, payments };
}

// PRD 6.1 — resumo do dia calculado só da projeção local (nunca depende de
// sync com a nuvem estar em dia). `localDateKey`/`computeCashRegisterSummary`
// movidos pro sync-engine no M11 pra serem reaproveitados tal e qual pelo
// endpoint de relatório do backend (PRD 6.2) — ver `packages/sync-engine/src/reporting.ts`.

/**
 * CORS: o frontend (http://localhost:1420 em dev, tauri://localhost ou
 * https://tauri.localhost em produção) e o sidecar (http://127.0.0.1:4550)
 * são origens diferentes do ponto de vista do navegador, mesmo sendo
 * processos do mesmo app na mesma máquina — sem isso, o WKWebView bloqueia
 * a leitura da resposta ("Load failed", achado no Spike 1). Liberar
 * qualquer origem aqui é seguro porque o servidor só escuta em loopback.
 */
function withCors(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(chunks.length === 0 ? undefined : JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

/**
 * M12 (ARCH §7, achado na revisão de segurança) — o servidor precisa
 * escutar em todas as interfaces (não só loopback) pra M9's sync LAN
 * funcionar de verdade entre DUAS MÁQUINAS físicas na mesma rede (o teste
 * do M9/M10/M11 usou processos na mesma máquina via 127.0.0.1 com portas
 * diferentes, o que mascarava esse bug). Mas a API local do frontend
 * (`/state`, `/orders`, `/categories` etc.) não tem autenticação nenhuma
 * por design (não precisa — só o próprio app local a consome) — abrir
 * ela pra rede deixaria qualquer dispositivo no Wi-Fi do bar ler os dados
 * do estabelecimento. Só as rotas explicitamente feitas pra sync entre
 * terminais (`/sync/*`, autenticadas pelo token de pareamento) e `/health`
 * podem ser alcançadas de fora desta máquina; todo o resto exige loopback.
 */
const LAN_FACING_PATHS = ["/sync/events", "/sync/sponsor-cloud-registration"];

function isLoopback(req: http.IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

const server = http.createServer(async (req, res) => {
  withCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { status: "ok", pid: process.pid, startedAt, platform: process.platform, arch: process.arch });
    return;
  }

  if (!LAN_FACING_PATHS.includes(url.pathname) && !isLoopback(req)) {
    sendJson(res, 403, { error: "esta API só aceita conexões desta máquina" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/events") {
    try {
      const body = await readJsonBody(req);
      const result = DomainEventSchema.safeParse(body);
      if (!result.success) {
        sendJson(res, 400, { error: "evento inválido", details: result.error.issues });
        return;
      }
      insertEvent(db, result.data);
      sendJson(res, 201, result.data);
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/events") {
    const aggregateId = url.searchParams.get("aggregateId");
    if (aggregateId) {
      // Base do log de auditoria (PRD 1.3): todo evento já carrega
      // `operatorId`+`hlc`, então o histórico completo de um agregado
      // (ex: cancelamentos do M6) é só isto, sem estrutura extra.
      sendJson(res, 200, findEventsByAggregateId(db, aggregateId));
      return;
    }
    const cursor = url.searchParams.get("since") ?? undefined;
    sendJson(res, 200, listEventsSinceCursor(db, cursor));
    return;
  }

  // M9 (ARCH §2, §7) — espelha `/events`, mas autenticado pelo token de
  // pareamento LAN em vez de aberto pro frontend local: é o endpoint que
  // outro terminal do mesmo estabelecimento usa pra trocar eventos.
  if (req.method === "POST" && url.pathname === "/sync/events") {
    if (!requireLanToken(req, res)) return;
    try {
      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const eventsInput = Array.isArray(body?.events) ? body.events : [];
      const events = eventsInput.map((e) => DomainEventSchema.parse(e));
      insertEvents(db, events);
      sendJson(res, 200, { received: events.length });
    } catch (error) {
      sendJson(res, 400, { error: "lote de eventos inválido", details: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/sync/events") {
    if (!requireLanToken(req, res)) return;
    const cursor = url.searchParams.get("since") ?? undefined;
    sendJson(res, 200, listEventsSinceCursor(db, cursor));
    return;
  }

  // M9 (ARCH §7) — um peer LAN pareado (mesmo token) pede pra este terminal
  // "patrociná-lo" na nuvem: se este terminal já tem credencial de nuvem,
  // registra o peer como mais um terminal do MESMO estabelecimento (ver
  // comentário em `cloud-sync-client.ts` sobre o achado do teste do M9).
  if (req.method === "POST" && url.pathname === "/sync/sponsor-cloud-registration") {
    if (!requireLanToken(req, res)) return;
    try {
      const credential = loadCloudCredential(dataDir);
      if (!credential) {
        sendJson(res, 409, { error: "este terminal ainda não tem credencial de nuvem" });
        return;
      }
      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const newTerminalId = typeof body?.terminalId === "string" ? body.terminalId : "";
      if (newTerminalId.length === 0) {
        sendJson(res, 400, { error: "terminalId é obrigatório" });
        return;
      }
      const sponsorRes = await fetch(`${BACKEND_URL}/terminals`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential.credential}` },
        body: JSON.stringify({ terminalId: newTerminalId }),
        signal: AbortSignal.timeout(8000),
      });
      if (!sponsorRes.ok) {
        // M10 (PRD 8.1) — repassa o status/motivo reais (ex: 403 de limite de
        // plano atingido) pro terminal que pediu o patrocínio, em vez de
        // colapsar tudo num 502 genérico; ele precisa distinguir "bloqueio
        // definitivo do plano" de "erro transitório" pra decidir se vira
        // âncora de um estabelecimento novo ou fica bloqueado mostrando a
        // mensagem de upgrade.
        const body = await sponsorRes.json().catch(() => ({ error: "backend recusou o patrocínio de cadastro" }));
        sendJson(res, sponsorRes.status, body);
        return;
      }
      sendJson(res, 200, await sponsorRes.json());
    } catch {
      sendJson(res, 502, { error: "falha ao contatar a nuvem pra patrocinar o cadastro" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/state") {
    const state = project(sortEvents(listEventsSinceCursor(db)));
    // pinHash nunca deve sair pro frontend por essa via de leitura geral —
    // o log de eventos (/events) precisa carregar pra fins de sync (M9),
    // mas a UI não tem motivo nenhum pra ver o hash de ninguém.
    sendJson(res, 200, { ...state, operators: state.operators.map(({ pinHash: _pinHash, ...rest }) => rest) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/cash-register/summary") {
    const dateKey = url.searchParams.get("date") ?? localDateKey(Date.now());
    sendJson(res, 200, computeCashRegisterSummary(currentState().orders, dateKey));
    return;
  }

  if (req.method === "POST" && url.pathname === "/operators") {
    try {
      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const nameResult = typeof body?.name === "string" && body.name.trim().length > 0;
      const roleResult = OperatorRoleSchema.safeParse(body?.role);
      const pinResult = PinSchema.safeParse(body?.pin);
      if (!nameResult || !roleResult.success || !pinResult.success) {
        sendJson(res, 400, { error: "dados de operador inválidos" });
        return;
      }

      const operators = currentOperators();
      const session = loadSession(dataDir);

      // PRD 1.1 — só o dono cadastra operadores; exceto no bootstrap (nenhum
      // operador ainda existe), onde não há ninguém logado pra checar.
      if (operators.length > 0) {
        const actingOperator = operators.find((o) => o.id === session?.operatorId);
        if (!actingOperator || actingOperator.role !== "owner") {
          sendJson(res, 403, { error: "só o dono pode cadastrar operadores" });
          return;
        }
      }

      // PRD 1.1 — PIN único por estabelecimento.
      for (const existing of operators) {
        if (await verifyPin(pinResult.data, existing.pinHash)) {
          sendJson(res, 409, { error: "PIN já em uso por outro operador" });
          return;
        }
      }

      const operatorId = randomUUID();
      const pinHash = await hashPin(pinResult.data);
      const name = (body!.name as string).trim();
      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: session?.operatorId ?? operatorId, // bootstrap: o primeiro operador se autocadastra
        terminalId,
        createdAt: Date.now(),
        type: "operator_registered",
        aggregateType: "operator",
        aggregateId: operatorId,
        payload: { name, role: roleResult.data, pinHash },
      });
      insertEvent(db, event);
      sendJson(res, 201, { id: operatorId, name, role: roleResult.data });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/session/login") {
    try {
      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const pinResult = PinSchema.safeParse(body?.pin);
      if (!pinResult.success) {
        sendJson(res, 400, { error: "PIN inválido" });
        return;
      }

      for (const operator of currentOperators()) {
        if (await verifyPin(pinResult.data, operator.pinHash)) {
          saveSession(dataDir, operator.id);
          sendJson(res, 200, { id: operator.id, name: operator.name, role: operator.role });
          return;
        }
      }
      sendJson(res, 401, { error: "PIN incorreto" });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/session/logout") {
    clearSession(dataDir);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/session") {
    const session = loadSession(dataDir);
    const operator = session ? currentOperators().find((o) => o.id === session.operatorId) : undefined;
    if (!operator) {
      sendJson(res, 200, { operator: null });
      return;
    }
    sendJson(res, 200, { operator: { id: operator.id, name: operator.name, role: operator.role } });
    return;
  }

  // M9 (ARCH §7) — normalmente só o dono lê o token deste terminal pra
  // digitar no segundo terminal (ver comentário em `lan-pairing.ts`); exceto
  // no bootstrap do PRÓPRIO terminal novo, que ainda não tem dono nenhum
  // pra logar (ver `requireOwnerOrBootstrap`).
  if (req.method === "GET" && url.pathname === "/pairing/lan-token") {
    if (!requireOwnerOrBootstrap(res)) return;
    sendJson(res, 200, { token: loadOrCreateLanToken(dataDir) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/pairing/lan-token") {
    try {
      if (!requireOwnerOrBootstrap(res)) return;

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const token = typeof body?.token === "string" ? body.token.trim() : "";
      if (token.length === 0) {
        sendJson(res, 400, { error: "token é obrigatório" });
        return;
      }
      adoptLanToken(dataDir, token);
      sendJson(res, 200, { token });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return;
  }

  // M9 (ARCH §2, decisão 2) — fallback manual quando a descoberta mDNS não
  // encontra o outro terminal (rede bloqueia multicast, por exemplo).
  if (req.method === "GET" && url.pathname === "/pairing/manual-host") {
    if (!requireOwnerOrBootstrap(res)) return;
    sendJson(res, 200, loadManualHost(dataDir));
    return;
  }

  if (req.method === "POST" && url.pathname === "/pairing/manual-host") {
    try {
      if (!requireOwnerOrBootstrap(res)) return;

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const host = typeof body?.host === "string" ? body.host.trim() : "";
      const port = body?.port;
      if (host.length === 0 || typeof port !== "number" || !Number.isInteger(port) || port <= 0) {
        sendJson(res, 400, { error: "host e port são obrigatórios (port precisa ser inteiro positivo)" });
        return;
      }
      saveManualHost(dataDir, host, port);
      sendJson(res, 200, { host, port });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/pairing/manual-host") {
    if (!requireOwnerOrBootstrap(res)) return;
    clearManualHost(dataDir);
    res.writeHead(204);
    res.end();
    return;
  }

  // M10 (PRD 8.1) — a tela de Pareamento usa isto pra mostrar "conectado à
  // nuvem" vs. a mensagem clara de upgrade quando o patrocínio de cadastro
  // foi bloqueado por limite de plano (ver `cloud-sync-client.ts`).
  if (req.method === "GET" && url.pathname === "/pairing/cloud-status") {
    if (!requireOwnerOrBootstrap(res)) return;
    sendJson(res, 200, {
      connected: loadCloudCredential(dataDir) !== null,
      blockedReason: loadRegistrationError(dataDir),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/categories") {
    try {
      const acting = requireOwner(res);
      if (!acting) return;

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (name.length === 0) {
        sendJson(res, 400, { error: "nome da categoria é obrigatório" });
        return;
      }

      const categoryId = randomUUID();
      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId,
        createdAt: Date.now(),
        type: "category_registered",
        aggregateType: "category",
        aggregateId: categoryId,
        payload: { name },
      });
      insertEvent(db, event);
      sendJson(res, 201, { id: categoryId, name });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/products") {
    try {
      const acting = requireOwner(res);
      if (!acting) return;

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const priceCents = body?.priceCents;
      const categoryId = typeof body?.categoryId === "string" ? body.categoryId : "";
      const active = typeof body?.active === "boolean" ? body.active : true;

      if (name.length === 0 || typeof priceCents !== "number" || !Number.isInteger(priceCents) || priceCents < 0) {
        sendJson(res, 400, { error: "dados de produto inválidos" });
        return;
      }
      if (!currentState().categories.some((c) => c.id === categoryId)) {
        sendJson(res, 400, { error: "categoria não encontrada" });
        return;
      }

      const productId = randomUUID();
      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId,
        createdAt: Date.now(),
        type: "product_registered",
        aggregateType: "product",
        aggregateId: productId,
        payload: { name, priceCents, categoryId, active },
      });
      insertEvent(db, event);
      sendJson(res, 201, { id: productId, name, priceCents, categoryId, active });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return;
  }

  const productStatusMatch = url.pathname.match(/^\/products\/([^/]+)\/status$/);
  if (req.method === "POST" && productStatusMatch) {
    try {
      const acting = requireOwner(res);
      if (!acting) return;

      const productId = productStatusMatch[1]!;
      const product = currentState().products.find((p) => p.id === productId);
      if (!product) {
        sendJson(res, 404, { error: "produto não encontrado" });
        return;
      }

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      if (typeof body?.active !== "boolean") {
        sendJson(res, 400, { error: "campo 'active' (boolean) é obrigatório" });
        return;
      }

      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId,
        createdAt: Date.now(),
        type: "product_status_changed",
        aggregateType: "product",
        aggregateId: productId,
        payload: { active: body.active },
      });
      insertEvent(db, event);
      sendJson(res, 200, { id: productId, active: body.active });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/tables") {
    try {
      const acting = requireOwner(res);
      if (!acting) return;

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const identifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
      const capacity = body?.capacity;
      if (identifier.length === 0) {
        sendJson(res, 400, { error: "identificador da mesa é obrigatório" });
        return;
      }
      if (capacity !== undefined && (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity <= 0)) {
        sendJson(res, 400, { error: "capacidade precisa ser um número inteiro positivo" });
        return;
      }

      const tableId = randomUUID();
      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId,
        createdAt: Date.now(),
        type: "table_registered",
        aggregateType: "table",
        aggregateId: tableId,
        payload: capacity === undefined ? { identifier } : { identifier, capacity },
      });
      insertEvent(db, event);
      sendJson(res, 201, { id: tableId, identifier, capacity });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/establishment/settings") {
    try {
      const acting = requireOwner(res);
      if (!acting) return;

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const defaultServiceFeePercent = body?.defaultServiceFeePercent;
      if (typeof defaultServiceFeePercent !== "number" || defaultServiceFeePercent < 0) {
        sendJson(res, 400, { error: "taxa de serviço padrão precisa ser um número >= 0" });
        return;
      }

      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId,
        createdAt: Date.now(),
        type: "establishment_settings_updated",
        aggregateType: "establishment",
        aggregateId: "establishment",
        payload: { defaultServiceFeePercent },
      });
      insertEvent(db, event);
      sendJson(res, 200, { defaultServiceFeePercent });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/orders") {
    try {
      const acting = requireSession(res);
      if (!acting) return;

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const source = body?.source;
      if (source !== "table" && source !== "standalone") {
        sendJson(res, 400, { error: "source precisa ser 'table' ou 'standalone'" });
        return;
      }

      const state = currentState();
      const openOrders = state.orders.filter((o) => o.mergedInto === undefined && o.status === "open");
      const orderLimit = maxConcurrentOrders();
      // PRD 2.7/8.2 — limite real do plano (cache local, ver `maxConcurrentOrders`).
      if (openOrders.length >= orderLimit) {
        sendJson(res, 409, { error: `limite de ${orderLimit} comandas simultâneas atingido — faça upgrade de plano pra aumentar` });
        return;
      }

      let payload: { source: "table"; tableId: string } | { source: "standalone"; number: number };
      if (source === "table") {
        const tableId = typeof body?.tableId === "string" ? body.tableId : "";
        if (!state.tables.some((t) => t.id === tableId)) {
          sendJson(res, 400, { error: "mesa não encontrada" });
          return;
        }
        // PRD 2.2 — invariante local "1 comanda aberta por mesa" (conflito
        // entre terminais offline continua resolvido pelo ARCH §4.2 na
        // hora de mesclar — isso aqui só evita o caso óbvio no mesmo terminal).
        if (!isTableFree(state, tableId)) {
          sendJson(res, 409, { error: "mesa já tem uma comanda aberta" });
          return;
        }
        payload = { source: "table", tableId };
      } else {
        // PRD 2.3 — número sequencial visível, nunca reaproveitado.
        const usedNumbers = state.orders
          .filter((o) => o.origin.source === "standalone")
          .map((o) => (o.origin as { number: number }).number);
        const number = usedNumbers.length > 0 ? Math.max(...usedNumbers) + 1 : 1;
        payload = { source: "standalone", number };
      }

      const orderId = randomUUID();
      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId,
        createdAt: Date.now(),
        type: "order_opened",
        aggregateType: "order",
        aggregateId: orderId,
        payload,
      });
      insertEvent(db, event);
      sendJson(res, 201, { id: orderId, ...payload });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return;
  }

  const orderTransferMatch = url.pathname.match(/^\/orders\/([^/]+)\/transfer$/);
  if (req.method === "POST" && orderTransferMatch) {
    try {
      const acting = requireSession(res);
      if (!acting) return;

      const orderId = orderTransferMatch[1]!;
      const state = currentState();
      const order = state.orders.find((o) => o.id === orderId);
      if (!order || order.mergedInto !== undefined) {
        sendJson(res, 404, { error: "comanda não encontrada" });
        return;
      }
      if (order.status !== "open") {
        sendJson(res, 409, { error: "comanda fechada não pode ser transferida" });
        return;
      }
      if (!order.currentTableId) {
        sendJson(res, 409, { error: "comanda avulsa não tem mesa pra transferir" });
        return;
      }

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const destinationTableId = typeof body?.destinationTableId === "string" ? body.destinationTableId : "";
      if (!state.tables.some((t) => t.id === destinationTableId)) {
        sendJson(res, 400, { error: "mesa de destino não encontrada" });
        return;
      }
      if (destinationTableId === order.currentTableId) {
        sendJson(res, 400, { error: "mesa de destino é a mesma mesa atual" });
        return;
      }
      // PRD 2.5 — mesa de destino precisa estar livre (senão é caso de
      // junção, história 2.6 — não de transferência).
      if (!isTableFree(state, destinationTableId)) {
        sendJson(res, 409, { error: "mesa de destino já tem uma comanda aberta" });
        return;
      }

      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId,
        createdAt: Date.now(),
        type: "order_transferred",
        aggregateType: "order",
        aggregateId: orderId,
        payload: { originTableId: order.currentTableId, destinationTableId },
      });
      insertEvent(db, event);
      sendJson(res, 200, { id: orderId, originTableId: order.currentTableId, destinationTableId });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return;
  }

  const orderItemsMatch = url.pathname.match(/^\/orders\/([^/]+)\/items$/);
  if (req.method === "POST" && orderItemsMatch) {
    try {
      const acting = requireSession(res);
      if (!acting) return;

      const orderId = orderItemsMatch[1]!;
      const state = currentState();
      const order = state.orders.find((o) => o.id === orderId);
      if (!order || order.mergedInto !== undefined) {
        sendJson(res, 404, { error: "comanda não encontrada" });
        return;
      }
      if (order.status !== "open") {
        sendJson(res, 409, { error: "comanda fechada não aceita novos itens" });
        return;
      }

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const productId = typeof body?.productId === "string" ? body.productId : "";
      const quantity = body?.quantity;
      const note = typeof body?.note === "string" && body.note.trim().length > 0 ? body.note.trim() : undefined;
      if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0) {
        sendJson(res, 400, { error: "quantidade precisa ser um número inteiro positivo" });
        return;
      }
      // PRD 3.2 — produto inativo não aparece na busca do garçom; reforçado
      // aqui pra não depender só do filtro client-side do ProductSearch.
      const product = state.products.find((p) => p.id === productId && p.active);
      if (!product) {
        sendJson(res, 400, { error: "produto não encontrado ou inativo" });
        return;
      }

      const itemId = randomUUID();
      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId,
        createdAt: Date.now(),
        type: "item_added",
        aggregateType: "order",
        aggregateId: orderId,
        // PRD 4.1 — denormalizado de propósito (ver comentário em
        // shared-types/src/events.ts): preço de venda não muda
        // retroativamente se o produto for editado depois.
        payload: { itemId, name: product.name, unitPriceCents: product.priceCents, quantity, note },
      });
      insertEvent(db, event);
      sendJson(res, 201, { itemId, name: product.name, unitPriceCents: product.priceCents, quantity, note });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return;
  }

  const itemCancelMatch = url.pathname.match(/^\/orders\/([^/]+)\/items\/([^/]+)\/cancel$/);
  if (req.method === "POST" && itemCancelMatch) {
    try {
      const acting = requireSession(res);
      if (!acting) return;
      // PRD §2 — garçom lança item, mas só caixa/dono cancela.
      if (acting.role === "waiter") {
        sendJson(res, 403, { error: "garçom não pode cancelar item" });
        return;
      }

      const [, orderId, itemId] = itemCancelMatch;
      const state = currentState();
      const order = state.orders.find((o) => o.id === orderId);
      if (!order || order.mergedInto !== undefined) {
        sendJson(res, 404, { error: "comanda não encontrada" });
        return;
      }
      if (order.status !== "open") {
        sendJson(res, 409, { error: "comanda fechada não aceita cancelamento de item" });
        return;
      }
      const item = order.items.find((i) => i.id === itemId);
      if (!item) {
        sendJson(res, 404, { error: "item não encontrado" });
        return;
      }
      if (item.canceled) {
        sendJson(res, 409, { error: "item já está cancelado" });
        return;
      }

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const reasonResult = CancelReasonSchema.safeParse(body?.reason);
      const note = typeof body?.note === "string" && body.note.trim().length > 0 ? body.note.trim() : undefined;
      if (!reasonResult.success) {
        sendJson(res, 400, { error: "motivo de cancelamento inválido" });
        return;
      }
      // PRD 1.3 — motivo "outro" exige texto livre.
      if (reasonResult.data === "other" && !note) {
        sendJson(res, 400, { error: "motivo 'outro' exige uma observação" });
        return;
      }

      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId,
        createdAt: Date.now(),
        type: "item_canceled",
        aggregateType: "order",
        aggregateId: orderId!,
        payload: { itemId: itemId!, reason: reasonResult.data, note },
      });
      insertEvent(db, event);
      sendJson(res, 200, { itemId, reason: reasonResult.data, note });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return;
  }

  const orderCloseMatch = url.pathname.match(/^\/orders\/([^/]+)\/close$/);
  if (req.method === "POST" && orderCloseMatch) {
    try {
      const acting = requireSession(res);
      if (!acting) return;
      // PRD §2 — fechamento é ação de caixa/dono, garçom não fecha comanda.
      if (acting.role === "waiter") {
        sendJson(res, 403, { error: "garçom não pode fechar comanda" });
        return;
      }

      const orderId = orderCloseMatch[1]!;
      const state = currentState();
      const order = state.orders.find((o) => o.id === orderId);
      if (!order || order.mergedInto !== undefined) {
        sendJson(res, 404, { error: "comanda não encontrada" });
        return;
      }
      if (order.status !== "open") {
        sendJson(res, 409, { error: "comanda já está fechada" });
        return;
      }

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const serviceFeePercent = body?.serviceFeePercent;
      if (typeof serviceFeePercent !== "number" || serviceFeePercent < 0) {
        sendJson(res, 400, { error: "taxa de serviço inválida" });
        return;
      }
      const splitsInput = Array.isArray(body?.splits) ? body.splits : [];

      const subtotalCents = computeSubtotalCents(order);
      const serviceFeeCents = Math.round((subtotalCents * serviceFeePercent) / 100);
      const totalCents = subtotalCents + serviceFeeCents;

      const splitsResult = parseSplits(splitsInput, totalCents);
      if (!splitsResult.ok) {
        sendJson(res, 400, { error: splitsResult.error });
        return;
      }

      const closedEvent = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId,
        createdAt: Date.now(),
        type: "order_closed",
        aggregateType: "order",
        aggregateId: orderId,
        payload: { subtotalCents, serviceFeePercent, serviceFeeCents, totalCents },
      });
      insertEvent(db, closedEvent);

      for (const payment of splitsResult.payments) {
        const paymentEvent = DomainEventSchema.parse({
          id: randomUUID(),
          hlc: nextHlc(),
          operatorId: acting.id,
          terminalId,
          createdAt: Date.now(),
          type: "payment_recorded",
          aggregateType: "order",
          aggregateId: orderId,
          payload: payment,
        });
        insertEvent(db, paymentEvent);
      }

      sendJson(res, 200, { id: orderId, subtotalCents, serviceFeePercent, serviceFeeCents, totalCents, payments: splitsResult.payments });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

// M12 — precisa escutar em todas as interfaces pro sync LAN (`/sync/*`) ser
// alcançável por outro terminal na rede; o guard de loopback acima protege
// o resto da API local. Sem host explícito aqui, Node escuta em "::" (todas as interfaces).
server.listen(PORT, () => {
  // stdout é observado pelo processo pai (Tauri) só pra debug manual.
  console.log(`[sidecar] ouvindo em http://0.0.0.0:${PORT} (pid ${process.pid}) — banco em ${dbPath}`);
});

function shutdown() {
  console.log("[sidecar] encerrando...");
  stopLanSync();
  stopCloudSync();
  stopDiscovery();
  db.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

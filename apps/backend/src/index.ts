import http from "node:http";
import { randomBytes } from "node:crypto";
import { DomainEventSchema } from "@tabwise/shared-types";
import {
  project,
  sortEvents,
  hashPin as hashSecret,
  verifyPin as verifySecret,
  computeCashRegisterSummary,
  computeConsolidatedCashSessionSummary,
  localDateKey,
  type ProjectedState,
} from "@tabwise/sync-engine";
import {
  openDatabase,
  createEstablishment,
  registerTerminal,
  findTerminal,
  touchTerminal,
  insertEvents,
  listEventsSince,
  upsertProjection,
  getProjection,
  countTerminals,
  getEstablishmentPlan,
  type Db,
} from "./db.js";

/**
 * M9 (ARCH §5, §8): backend de sync com a nuvem. Participa do mesmo
 * protocolo de replicação de eventos que o sync LAN entre terminais — só
 * o transporte muda (HTTPS pela internet em vez de HTTP na LAN). `hashPin`/
 * `verifyPin` do sync-engine são reaproveitados aqui pra credencial de
 * terminal: o nome vem do uso original em PIN (M3), mas por baixo é só
 * scrypt genérico — não faz sentido duplicar o hashing de segredo.
 */

const PORT = Number(process.env.PORT) || 4551;
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://tabwise:tabwise_dev@localhost:5432/tabwise";

const db: Db = await openDatabase(DATABASE_URL);

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
 * PRD Épico 8/ARCH §6/§7 — credencial de terminal: "<terminalId>:<segredo>"
 * no header Authorization. O terminalId identifica QUAL hash verificar (o
 * hash sozinho não dá pra buscar no banco), o segredo é o que prova posse
 * da credencial emitida no pareamento.
 */
async function authenticateTerminal(req: http.IncomingMessage, res: http.ServerResponse): Promise<{ terminalId: string; establishmentId: string } | null> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  const [terminalId, secret] = token?.split(":") ?? [];
  if (!terminalId || !secret) {
    sendJson(res, 401, { error: "credencial de terminal ausente ou inválida" });
    return null;
  }
  const terminal = await findTerminal(db, terminalId);
  if (!terminal || !(await verifySecret(secret, terminal.credentialHash))) {
    sendJson(res, 401, { error: "credencial de terminal inválida" });
    return null;
  }
  touchTerminal(db, terminalId).catch(() => {}); // best-effort, não bloqueia a resposta
  return { terminalId, establishmentId: terminal.establishmentId };
}

async function refreshProjection(establishmentId: string): Promise<void> {
  const events = await listEventsSince(db, establishmentId);
  const state = project(sortEvents(events));
  await upsertProjection(db, establishmentId, state);
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { status: "ok", pid: process.pid });
    return;
  }

  // PRD Épico 8/ARCH §7 — bootstrap: o primeiro terminal de um
  // estabelecimento novo se autocadastra (não existe login web de dono no
  // MVP pra emitir pareamento manualmente — decisão registrada em
  // implementation-plan.md M9). Sem autenticação, por definição: é assim
  // que a credencial nasce.
  if (req.method === "POST" && url.pathname === "/register") {
    try {
      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const terminalId = typeof body?.terminalId === "string" ? body.terminalId : "";
      const establishmentName = typeof body?.establishmentName === "string" && body.establishmentName.trim() ? body.establishmentName.trim() : "Meu estabelecimento";
      if (terminalId.length === 0) {
        sendJson(res, 400, { error: "terminalId é obrigatório" });
        return;
      }
      const existing = await findTerminal(db, terminalId);
      if (existing) {
        sendJson(res, 409, { error: "terminal já cadastrado" });
        return;
      }

      const { id: establishmentId } = await createEstablishment(db, establishmentName);
      const secret = randomBytes(24).toString("hex");
      const credentialHash = await hashSecret(secret);
      await registerTerminal(db, terminalId, establishmentId, credentialHash);

      sendJson(res, 201, { establishmentId, credential: `${terminalId}:${secret}` });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return;
  }

  // M9 (ARCH §7) — um terminal JÁ registrado "patrocina" o cadastro de outro
  // terminal do mesmo estabelecimento (par LAN pareado pelo mesmo token de
  // `lan-pairing.ts`) sob o MESMO establishmentId. Sem isso, cada terminal
  // que se autocadastrasse virariam estabelecimentos separados na nuvem
  // mesmo sincronizando entre si na LAN — achado durante o teste do M9.
  if (req.method === "POST" && url.pathname === "/terminals") {
    const auth = await authenticateTerminal(req, res);
    if (!auth) return;
    try {
      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const newTerminalId = typeof body?.terminalId === "string" ? body.terminalId : "";
      if (newTerminalId.length === 0) {
        sendJson(res, 400, { error: "terminalId é obrigatório" });
        return;
      }
      const existing = await findTerminal(db, newTerminalId);
      if (existing) {
        sendJson(res, 409, { error: "terminal já cadastrado" });
        return;
      }

      // PRD 8.1 — limite de terminais do plano (free = 1, ver default em
      // schema.sql). É bem aqui, no momento de conectar um 2º terminal a um
      // estabelecimento existente, que o limite precisa ser aplicado — o
      // bootstrap em `POST /register` sempre cria terminal #1 de um
      // estabelecimento novo, esse nunca esbarra no limite.
      const plan = await getEstablishmentPlan(db, auth.establishmentId);
      const terminalCount = await countTerminals(db, auth.establishmentId);
      if (plan && terminalCount >= plan.maxTerminals) {
        sendJson(res, 403, {
          error: `limite de ${plan.maxTerminals} terminal(is) do plano atingido — faça upgrade pra conectar mais terminais`,
        });
        return;
      }

      const secret = randomBytes(24).toString("hex");
      const credentialHash = await hashSecret(secret);
      await registerTerminal(db, newTerminalId, auth.establishmentId, credentialHash);
      sendJson(res, 201, { establishmentId: auth.establishmentId, credential: `${newTerminalId}:${secret}` });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/sync/push") {
    const auth = await authenticateTerminal(req, res);
    if (!auth) return;
    try {
      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const eventsInput = Array.isArray(body?.events) ? body.events : [];
      const events = eventsInput.map((e) => DomainEventSchema.parse(e));
      const inserted = await insertEvents(db, auth.establishmentId, events);
      if (inserted > 0) await refreshProjection(auth.establishmentId);
      sendJson(res, 200, { received: events.length, inserted });
    } catch (error) {
      sendJson(res, 400, { error: "lote de eventos inválido", details: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/sync/pull") {
    const auth = await authenticateTerminal(req, res);
    if (!auth) return;
    const cursor = url.searchParams.get("since") ?? undefined;
    const events = await listEventsSince(db, auth.establishmentId, cursor);
    sendJson(res, 200, events);
    return;
  }

  // PRD Épico 6.2/8 (M11, fora do escopo do M9) — endpoint de relatório
  // read-only entra depois; a projeção já fica pronta aqui desde já.
  if (req.method === "GET" && url.pathname === "/sync/state") {
    const auth = await authenticateTerminal(req, res);
    if (!auth) return;
    sendJson(res, 200, (await getProjection(db, auth.establishmentId)) ?? {});
    return;
  }

  // M10 (ARCH §6, PRD 8.2/8.3) — terminal lê aqui os limites do seu plano
  // pra cachear localmente; enforcement de verdade acontece no sidecar
  // (offline-first, NFR1), este endpoint só é a fonte de verdade.
  if (req.method === "GET" && url.pathname === "/sync/plan") {
    const auth = await authenticateTerminal(req, res);
    if (!auth) return;
    const plan = await getEstablishmentPlan(db, auth.establishmentId);
    if (!plan) {
      sendJson(res, 404, { error: "estabelecimento não encontrado" });
      return;
    }
    sendJson(res, 200, plan);
    return;
  }

  /**
   * PRD 6.2/NFR4 — endpoint de relatório read-only, existe desde a primeira
   * versão do backend por requisito de arquitetura, mesmo sem tela remota
   * nenhuma consumindo ele ainda no MVP (validação de "pronto" é só o
   * endpoint responder certo). Mesma lógica do resumo de caixa do sidecar
   * (PRD 6.1) via `computeCashRegisterSummary` do sync-engine — só a fonte
   * de `orders` muda: aqui é a projeção Postgres do estabelecimento inteiro
   * (todos os terminais já sincronizados), não a réplica SQLite de um único
   * terminal.
   *
   * Épico 3 (Story 3.1) — passa a incluir `cashSession`, o status ATUAL da
   * sessão de caixa canônica (`computeConsolidatedCashSessionSummary`, ou
   * `null` se nenhuma estiver aberta), ao lado dos campos de venda já
   * existentes acima — sem alterar nenhum campo já devolvido. Descoberta de
   * arquitetura, não migration nova: `projection.cashSessions` já é
   * projetado e persistido (JSONB em `projections`) desde o Épico 1, só
   * nunca tinha sido LIDO por nenhum endpoint (Design Notes de spec-3-1).
   *
   * Achado no code review, 2026-09-30 (blind-hunter): `cashSession` usa
   * `Date.now()` SEMPRE, independente do `dateKey` (`date` opcional acima) —
   * proposital, não um bug: "sessão de caixa" é um conceito de "agora", não
   * histórico (Design Notes de spec-3-1 — o histórico de sessões encerradas
   * já existe localmente desde a Story 1.4). Consultar um `date` no passado
   * só afeta os campos de VENDA acima; `cashSession` continua sendo sempre o
   * status atual, mesmo numa consulta histórica.
   */
  if (req.method === "GET" && url.pathname === "/reports/cash-register") {
    const auth = await authenticateTerminal(req, res);
    if (!auth) return;
    const dateKey = url.searchParams.get("date") ?? localDateKey(Date.now());
    const projection = (await getProjection(db, auth.establishmentId)) as ProjectedState | null;
    sendJson(res, 200, {
      ...computeCashRegisterSummary(projection?.orders ?? [], dateKey),
      cashSession: computeConsolidatedCashSessionSummary(projection?.cashSessions ?? [], projection?.orders ?? [], Date.now()),
    });
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`[backend] ouvindo em http://localhost:${PORT} (pid ${process.pid})`);
});

function shutdown() {
  console.log("[backend] encerrando...");
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { DomainEventSchema, OperatorRoleSchema, PinSchema } from "@passa-a-regua/shared-types";
import {
  openDatabase,
  insertEvent,
  listEventsSinceCursor,
  findEventsByAggregateId,
  project,
  sortEvents,
  hashPin,
  verifyPin,
} from "@passa-a-regua/sync-engine";
import { nextHlc } from "./clock.js";
import { loadOrCreateTerminalId } from "./terminal-identity.js";
import { loadSession, saveSession, clearSession } from "./session.js";

/**
 * M2 (ARCH §9, implementation-plan.md): sidecar real conectado ao
 * sync-engine — abre o SQLite local no start e expõe uma API HTTP mínima
 * pro frontend escrever/ler eventos. M3 (PRD Épico 1): autenticação de
 * operador por PIN e sessão de terminal.
 */

const PORT = 4550;
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

function currentOperators() {
  return project(sortEvents(listEventsSinceCursor(db))).operators;
}

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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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

  if (req.method === "GET" && url.pathname === "/state") {
    const state = project(sortEvents(listEventsSinceCursor(db)));
    // pinHash nunca deve sair pro frontend por essa via de leitura geral —
    // o log de eventos (/events) precisa carregar pra fins de sync (M9),
    // mas a UI não tem motivo nenhum pra ver o hash de ninguém.
    sendJson(res, 200, { ...state, operators: state.operators.map(({ pinHash: _pinHash, ...rest }) => rest) });
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

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  // stdout é observado pelo processo pai (Tauri) só pra debug manual.
  console.log(`[sidecar] ouvindo em http://127.0.0.1:${PORT} (pid ${process.pid}) — banco em ${dbPath}`);
});

function shutdown() {
  console.log("[sidecar] encerrando...");
  db.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

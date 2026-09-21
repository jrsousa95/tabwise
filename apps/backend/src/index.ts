import http from "node:http";
import { randomBytes } from "node:crypto";
import { DomainEventSchema } from "@passa-a-regua/shared-types";
import { project, sortEvents, hashPin as hashSecret, verifyPin as verifySecret } from "@passa-a-regua/sync-engine";
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
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://passa_a_regua:passa_a_regua_dev@localhost:5432/passa_a_regua";

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

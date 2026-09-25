import http from "node:http";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { openDatabase } from "@passa-a-regua/sync-engine";
import { loadOrCreateTerminalId } from "./terminal-identity.js";
import { loadOrCreateLanToken } from "./lan-pairing.js";
import { startDiscovery, stopDiscovery } from "./discovery.js";
import { startLanSyncLoop } from "./lan-sync-client.js";
import { startCloudSyncLoop } from "./cloud-sync-client.js";
import { createRequestContext } from "./context.js";
import { withCors, sendJson } from "./http-helpers.js";
import { handleEventRoutes } from "./routes/events.js";
import { handleStateRoutes } from "./routes/state.js";
import { handleOperatorRoutes } from "./routes/operators.js";
import { handlePairingRoutes } from "./routes/pairing.js";
import { handleCatalogRoutes } from "./routes/catalog.js";
import { handleTableRoutes } from "./routes/tables.js";
import { handleEstablishmentRoutes } from "./routes/establishment.js";
import { handleOrderRoutes } from "./routes/orders.js";
import { handleCashSessionRoutes } from "./routes/cash-sessions.js";

/**
 * M2 (ARCH §9, implementation-plan.md): sidecar real conectado ao
 * sync-engine — abre o SQLite local no start e expõe uma API HTTP mínima
 * pro frontend escrever/ler eventos. M3 (PRD Épico 1): autenticação de
 * operador por PIN e sessão de terminal.
 *
 * Retrospectiva do MVP (M0-M12, `_bmad-output/implementation-artifacts/
 * retro-mvp-m0-m12-2026-09-21.md`) apontou este arquivo como um "deus"
 * (1.269 linhas, 31 rotas inline) e recomendou quebrá-lo por domínio —
 * feito nesta revisão: o estado/autorização compartilhados viraram
 * `context.ts` (`RequestContext`), e cada domínio de rota virou seu
 * próprio módulo em `routes/`. Este arquivo agora só cuida de boot
 * (SQLite, descoberta mDNS, sync LAN/nuvem) e do dispatch HTTP — nenhum
 * comportamento mudou, é reorganização pura.
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

const ctx = createRequestContext(db, dataDir, terminalId);

// M9 (ARCH §2, §5, §7): descoberta mDNS + sync LAN e sync com a nuvem
// rodando em paralelo, cada um no seu próprio ciclo independente — queda de
// um não trava o outro.
loadOrCreateLanToken(dataDir); // garante que o token existe desde o boot (tela de Pareamento só lê depois)
startDiscovery(terminalId, PORT);
const stopLanSync = startLanSyncLoop(db, dataDir);
const stopCloudSync = startCloudSyncLoop(db, dataDir, terminalId);

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

  if (await handleEventRoutes(req, res, url, ctx)) return;
  if (await handleStateRoutes(req, res, url, ctx)) return;
  if (await handleOperatorRoutes(req, res, url, ctx)) return;
  if (await handlePairingRoutes(req, res, url, ctx)) return;
  if (await handleCatalogRoutes(req, res, url, ctx)) return;
  if (await handleTableRoutes(req, res, url, ctx)) return;
  if (await handleEstablishmentRoutes(req, res, url, ctx)) return;
  if (await handleOrderRoutes(req, res, url, ctx)) return;
  if (await handleCashSessionRoutes(req, res, url, ctx)) return;

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

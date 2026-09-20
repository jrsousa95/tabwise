import http from "node:http";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { EventoSchema } from "@passa-a-regua/shared-types";
import { abrirBanco, inserirEvento, listarEventosDesdeCursor, projetar, sortEventos } from "@passa-a-regua/sync-engine";

/**
 * M2 (ARCH §9, implementation-plan.md): sidecar real conectado ao
 * sync-engine — abre o SQLite local no start e expõe uma API HTTP mínima
 * pro frontend escrever/ler eventos. Ainda sem lógica de negócio (isso
 * entra épico por épico a partir do M3); esqueleto de fiação, não produto.
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
const db = abrirBanco(dbPath);

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

function enviarJson(res: http.ServerResponse, status: number, corpo: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(corpo));
}

function lerCorpoJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    req.on("data", (parte) => partes.push(parte));
    req.on("end", () => {
      try {
        resolve(partes.length === 0 ? undefined : JSON.parse(Buffer.concat(partes).toString("utf8")));
      } catch (erro) {
        reject(erro);
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
    enviarJson(res, 200, { status: "ok", pid: process.pid, startedAt, platform: process.platform, arch: process.arch });
    return;
  }

  if (req.method === "POST" && url.pathname === "/eventos") {
    try {
      const corpo = await lerCorpoJson(req);
      const resultado = EventoSchema.safeParse(corpo);
      if (!resultado.success) {
        enviarJson(res, 400, { error: "evento inválido", detalhes: resultado.error.issues });
        return;
      }
      inserirEvento(db, resultado.data);
      enviarJson(res, 201, resultado.data);
    } catch {
      enviarJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/eventos") {
    const cursor = url.searchParams.get("desde") ?? undefined;
    enviarJson(res, 200, listarEventosDesdeCursor(db, cursor));
    return;
  }

  if (req.method === "GET" && url.pathname === "/estado") {
    enviarJson(res, 200, projetar(sortEventos(listarEventosDesdeCursor(db))));
    return;
  }

  enviarJson(res, 404, { error: "not found" });
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

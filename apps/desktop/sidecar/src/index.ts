import http from "node:http";

/**
 * Spike 1 (M0, ARCH §9): valida que um processo Node, empacotado como
 * binário standalone via Node SEA, consegue ser iniciado pelo Tauri como
 * sidecar e responder a chamadas locais do frontend.
 *
 * Este NÃO é o sync-engine real (isso é o M1) — é só o esqueleto mínimo
 * para provar a cadeia: Tauri spawna o processo -> processo sobe um
 * servidor local -> frontend React consegue falar com ele.
 */

const PORT = 4550;
const startedAt = new Date().toISOString();

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        pid: process.pid,
        startedAt,
        platform: process.platform,
        arch: process.arch,
      })
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  // stdout é observado pelo processo pai (Tauri) só para debug manual do spike.
  console.log(`[sidecar] ouvindo em http://127.0.0.1:${PORT} (pid ${process.pid})`);
});

function shutdown() {
  console.log("[sidecar] encerrando...");
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

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

/**
 * CORS: o frontend (http://localhost:1420 em dev, tauri://localhost ou
 * https://tauri.localhost em produção) e o sidecar (http://127.0.0.1:4550)
 * são origens diferentes do ponto de vista do navegador — mesmo sendo o
 * mesmo app, na mesma máquina. Sem esses headers, o WKWebView (macOS)
 * bloqueia a leitura da resposta com o erro genérico "Load failed".
 * Como o sidecar só escuta em loopback (127.0.0.1) e nunca é exposto fora
 * da máquina, liberar qualquer origem aqui não é um risco de segurança
 * real — é só destravar a comunicação entre os dois processos locais.
 */
function withCors(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

const server = http.createServer((req, res) => {
  withCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

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

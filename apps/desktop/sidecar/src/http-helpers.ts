import type http from "node:http";

/**
 * CORS: o frontend (http://localhost:1420 em dev, tauri://localhost ou
 * https://tauri.localhost em produção) e o sidecar (http://127.0.0.1:4550)
 * são origens diferentes do ponto de vista do navegador, mesmo sendo
 * processos do mesmo app na mesma máquina — sem isso, o WKWebView bloqueia
 * a leitura da resposta ("Load failed", achado no Spike 1). Liberar
 * qualquer origem aqui é seguro porque o servidor só escuta em loopback
 * (as rotas alcançáveis de fora da máquina são autenticadas à parte — ver
 * `LAN_FACING_PATHS`/`isLoopback` em `index.ts`).
 */
export function withCors(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
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

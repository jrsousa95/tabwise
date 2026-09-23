import type http from "node:http";
import { sendJson, readJsonBody } from "../http-helpers.js";
import { loadOrCreateLanToken, adoptLanToken } from "../lan-pairing.js";
import { loadManualHost, saveManualHost, clearManualHost } from "../manual-host.js";
import { loadCloudCredential } from "../cloud-credential.js";
import { loadRegistrationError } from "../registration-status.js";
import type { RequestContext } from "../context.js";

/** M9 (ARCH §2, §7) — token LAN, host manual e status de nuvem, usados pela tela de Pareamento. */
export async function handlePairingRoutes(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: RequestContext): Promise<boolean> {
  // Normalmente só o dono lê o token deste terminal pra digitar no segundo
  // terminal (ver comentário em `lan-pairing.ts`); exceto no bootstrap do
  // PRÓPRIO terminal novo, que ainda não tem dono nenhum pra logar (ver
  // `requireOwnerOrBootstrap`).
  if (req.method === "GET" && url.pathname === "/pairing/lan-token") {
    if (!ctx.requireOwnerOrBootstrap(res)) return true;
    sendJson(res, 200, { token: loadOrCreateLanToken(ctx.dataDir) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/pairing/lan-token") {
    try {
      if (!ctx.requireOwnerOrBootstrap(res)) return true;

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const token = typeof body?.token === "string" ? body.token.trim() : "";
      if (token.length === 0) {
        sendJson(res, 400, { error: "token é obrigatório" });
        return true;
      }
      adoptLanToken(ctx.dataDir, token);
      sendJson(res, 200, { token });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  // M9 (ARCH §2, decisão 2) — fallback manual quando a descoberta mDNS não
  // encontra o outro terminal (rede bloqueia multicast, por exemplo).
  if (req.method === "GET" && url.pathname === "/pairing/manual-host") {
    if (!ctx.requireOwnerOrBootstrap(res)) return true;
    sendJson(res, 200, loadManualHost(ctx.dataDir));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/pairing/manual-host") {
    try {
      if (!ctx.requireOwnerOrBootstrap(res)) return true;

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const host = typeof body?.host === "string" ? body.host.trim() : "";
      const port = body?.port;
      if (host.length === 0 || typeof port !== "number" || !Number.isInteger(port) || port <= 0) {
        sendJson(res, 400, { error: "host e port são obrigatórios (port precisa ser inteiro positivo)" });
        return true;
      }
      saveManualHost(ctx.dataDir, host, port);
      sendJson(res, 200, { host, port });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  if (req.method === "DELETE" && url.pathname === "/pairing/manual-host") {
    if (!ctx.requireOwnerOrBootstrap(res)) return true;
    clearManualHost(ctx.dataDir);
    res.writeHead(204);
    res.end();
    return true;
  }

  // M10 (PRD 8.1) — a tela de Pareamento usa isto pra mostrar "conectado à
  // nuvem" vs. a mensagem clara de upgrade quando o patrocínio de cadastro
  // foi bloqueado por limite de plano (ver `cloud-sync-client.ts`).
  if (req.method === "GET" && url.pathname === "/pairing/cloud-status") {
    if (!ctx.requireOwnerOrBootstrap(res)) return true;
    sendJson(res, 200, {
      connected: loadCloudCredential(ctx.dataDir) !== null,
      blockedReason: loadRegistrationError(ctx.dataDir),
    });
    return true;
  }

  return false;
}

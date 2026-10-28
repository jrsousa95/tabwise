import type http from "node:http";
import { DomainEventSchema } from "@tabwise/shared-types";
import { insertEvent, insertEvents, listEventsSinceCursor, findEventsByAggregateId } from "@tabwise/sync-engine";
import { sendJson, readJsonBody } from "../http-helpers.js";
import type { RequestContext } from "../context.js";
import { loadCloudCredential } from "../cloud-credential.js";
import { BACKEND_URL } from "../cloud-sync-client.js";

/**
 * Log de eventos (append-only, ARCH §3.1) e sync — tanto a API local usada
 * pelo frontend (`/events`) quanto a API de sync LAN entre terminais
 * (`/sync/events`, `/sync/sponsor-cloud-registration`, M9, ARCH §2/§7).
 */
export async function handleEventRoutes(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: RequestContext): Promise<boolean> {
  if (req.method === "POST" && url.pathname === "/events") {
    try {
      const body = await readJsonBody(req);
      const result = DomainEventSchema.safeParse(body);
      if (!result.success) {
        sendJson(res, 400, { error: "evento inválido", details: result.error.issues });
        return true;
      }
      insertEvent(ctx.db, result.data);
      sendJson(res, 201, result.data);
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/events") {
    const aggregateId = url.searchParams.get("aggregateId");
    if (aggregateId) {
      // Base do log de auditoria (PRD 1.3): todo evento já carrega
      // `operatorId`+`hlc`, então o histórico completo de um agregado
      // (ex: cancelamentos do M6) é só isto, sem estrutura extra.
      sendJson(res, 200, findEventsByAggregateId(ctx.db, aggregateId));
      return true;
    }
    const cursor = url.searchParams.get("since") ?? undefined;
    sendJson(res, 200, listEventsSinceCursor(ctx.db, cursor));
    return true;
  }

  // M9 (ARCH §2, §7) — espelha `/events`, mas autenticado pelo token de
  // pareamento LAN em vez de aberto pro frontend local: é o endpoint que
  // outro terminal do mesmo estabelecimento usa pra trocar eventos.
  if (req.method === "POST" && url.pathname === "/sync/events") {
    if (!ctx.requireLanToken(req, res)) return true;
    try {
      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const eventsInput = Array.isArray(body?.events) ? body.events : [];
      const events = eventsInput.map((e) => DomainEventSchema.parse(e));
      insertEvents(ctx.db, events);
      sendJson(res, 200, { received: events.length });
    } catch (error) {
      sendJson(res, 400, { error: "lote de eventos inválido", details: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/sync/events") {
    if (!ctx.requireLanToken(req, res)) return true;
    const cursor = url.searchParams.get("since") ?? undefined;
    sendJson(res, 200, listEventsSinceCursor(ctx.db, cursor));
    return true;
  }

  // M9 (ARCH §7) — um peer LAN pareado (mesmo token) pede pra este terminal
  // "patrociná-lo" na nuvem: se este terminal já tem credencial de nuvem,
  // registra o peer como mais um terminal do MESMO estabelecimento (ver
  // comentário em `cloud-sync-client.ts` sobre o achado do teste do M9).
  if (req.method === "POST" && url.pathname === "/sync/sponsor-cloud-registration") {
    if (!ctx.requireLanToken(req, res)) return true;
    try {
      const credential = loadCloudCredential(ctx.dataDir);
      if (!credential) {
        sendJson(res, 409, { error: "este terminal ainda não tem credencial de nuvem" });
        return true;
      }
      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const newTerminalId = typeof body?.terminalId === "string" ? body.terminalId : "";
      if (newTerminalId.length === 0) {
        sendJson(res, 400, { error: "terminalId é obrigatório" });
        return true;
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
        return true;
      }
      sendJson(res, 200, await sponsorRes.json());
    } catch {
      sendJson(res, 502, { error: "falha ao contatar a nuvem pra patrocinar o cadastro" });
    }
    return true;
  }

  return false;
}

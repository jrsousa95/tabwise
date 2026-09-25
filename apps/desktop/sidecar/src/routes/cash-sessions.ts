import type http from "node:http";
import { randomUUID } from "node:crypto";
import { DomainEventSchema } from "@passa-a-regua/shared-types";
import { insertEvent } from "@passa-a-regua/sync-engine";
import { sendJson, readJsonBody } from "../http-helpers.js";
import { nextHlc } from "../clock.js";
import type { RequestContext } from "../context.js";

/**
 * Épico 1 (Sessão de Caixa), Story 1.1 — abertura de sessão. Mesmo padrão de
 * `POST /orders` em `orders.ts:11-74`: `requireSession` + bloqueio inline de
 * `waiter` (mesma checagem por exclusão já usada em `/orders/:id/close`, não
 * um helper novo em `context.ts`), `randomUUID()` pro `aggregateId`,
 * `nextHlc()`, `DomainEventSchema.parse`, `insertEvent`.
 */
export async function handleCashSessionRoutes(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: RequestContext): Promise<boolean> {
  if (req.method === "POST" && url.pathname === "/cash-sessions") {
    try {
      const acting = ctx.requireSession(res);
      if (!acting) return true;
      // PRD Épico 1 — garçom não acessa nenhuma ação de sessão de caixa.
      if (acting.role === "waiter") {
        sendJson(res, 403, { error: "garçom não pode abrir sessão de caixa" });
        return true;
      }

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const openingAmountCents = body?.openingAmountCents;
      if (typeof openingAmountCents !== "number" || !Number.isInteger(openingAmountCents) || openingAmountCents <= 0) {
        sendJson(res, 400, { error: "valor de abertura inválido" });
        return true;
      }

      // Invariante "uma sessão aberta por vez" é do ESTABELECIMENTO inteiro
      // (nunca filtrado por terminal) — checagem local aqui só evita o caso
      // óbvio no mesmo terminal; conflito entre terminais offline continua
      // resolvido na projeção pelo menor HLC (ver `reconciliation.ts`).
      const state = ctx.currentState();
      if (ctx.isCashSessionOpen(state)) {
        sendJson(res, 400, { error: "já existe uma sessão de caixa aberta" });
        return true;
      }

      const sessionId = randomUUID();
      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId: ctx.terminalId,
        createdAt: Date.now(),
        type: "cash_session_opened",
        aggregateType: "cash_session",
        aggregateId: sessionId,
        payload: { openingAmountCents },
      });
      insertEvent(ctx.db, event);
      sendJson(res, 201, { id: sessionId, openingAmountCents, openedAt: event.createdAt });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  return false;
}

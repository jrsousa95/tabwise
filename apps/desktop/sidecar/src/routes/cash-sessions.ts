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

  /**
   * Épico 1 (Sessão de Caixa), Story 1.2 — sangria. Mesmo padrão de
   * `POST /cash-sessions`: `requireSession` + bloqueio inline de `waiter`,
   * mas sem id de sessão no path nem no corpo — só existe uma sessão
   * canônica aberta por vez, resolvida aqui via o mesmo filtro de
   * `isCashSessionOpen`.
   */
  if (req.method === "POST" && url.pathname === "/cash-sessions/withdrawals") {
    try {
      const acting = ctx.requireSession(res);
      if (!acting) return true;
      // PRD Épico 1 — garçom não acessa nenhuma ação de sessão de caixa.
      if (acting.role === "waiter") {
        sendJson(res, 403, { error: "garçom não pode registrar sangria" });
        return true;
      }

      // Achado no code review, 2026-09-26: o corpo precisa ser lido antes do
      // retorno antecipado de "sem sessão aberta" (mesma ordem de
      // `POST /cash-sessions` na Story 1.1) — senão o corpo nunca é drenado
      // do socket nesse caminho, risco real em conexão HTTP keep-alive
      // (bytes não lidos vazando pra próxima requisição no mesmo socket).
      // Os retornos antecipados ANTERIORES (401 sem sessão de login, 403
      // garçom) continuam sem ler o corpo — mesmo padrão pré-existente em
      // toda rota do sidecar (`requireSession`/checagem de papel sempre
      // vêm antes de `readJsonBody`), não é algo que esta story mudou.
      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const amountCents = body?.amountCents;
      if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents <= 0) {
        sendJson(res, 400, { error: "valor da sangria inválido" });
        return true;
      }
      const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
      if (reason.length === 0) {
        sendJson(res, 400, { error: "motivo da sangria é obrigatório" });
        return true;
      }

      const state = ctx.currentState();
      const openSession = state.cashSessions.find((s) => s.mergedInto === undefined && s.status === "open");
      if (!openSession) {
        sendJson(res, 400, { error: "nenhuma sessão de caixa aberta" });
        return true;
      }

      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId: ctx.terminalId,
        createdAt: Date.now(),
        type: "cash_withdrawal_recorded",
        aggregateType: "cash_session",
        aggregateId: openSession.id,
        payload: { amountCents, reason },
      });
      insertEvent(ctx.db, event);
      sendJson(res, 201, { id: event.id, amountCents, reason, recordedAt: event.createdAt });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  return false;
}

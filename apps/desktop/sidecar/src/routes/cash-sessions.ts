import type http from "node:http";
import { randomUUID } from "node:crypto";
import { DomainEventSchema } from "@passa-a-regua/shared-types";
import { insertEvent } from "@passa-a-regua/sync-engine";
import { sendJson, readJsonBody } from "../http-helpers.js";
import { nextHlc } from "../clock.js";
import type { RequestContext } from "../context.js";

/**
 * Épico 1 (Sessão de Caixa), Stories 1.2/1.3 — sangria e suprimento são
 * espelhos estruturais um do outro (mesma ordem corpo-antes-de-sessão,
 * achado no code review da 1.2; mesmo formato de payload). Extraído aqui
 * pra não duplicar a lógica uma terceira vez quando a história 1.4
 * (fechamento) precisar de algo parecido, e pra uma correção futura só
 * precisar mudar um lugar em vez de duas cópias manuais.
 */
async function handleCashMovementRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RequestContext,
  config: {
    eventType: "cash_withdrawal_recorded" | "cash_deposit_recorded";
    roleErrorMessage: string;
    amountErrorMessage: string;
    reasonErrorMessage: string;
  }
): Promise<void> {
  try {
    const acting = ctx.requireSession(res);
    if (!acting) return;
    // PRD Épico 1 — garçom não acessa nenhuma ação de sessão de caixa.
    if (acting.role === "waiter") {
      sendJson(res, 403, { error: config.roleErrorMessage });
      return;
    }

    // Achado no code review, 2026-09-26 (Story 1.2): o corpo precisa ser lido
    // antes do retorno antecipado de "sem sessão aberta" — senão o corpo
    // nunca é drenado do socket nesse caminho, risco real em conexão HTTP
    // keep-alive (bytes não lidos vazando pra próxima requisição no mesmo
    // socket). Os retornos ANTERIORES (401 sem sessão de login, 403 garçom)
    // continuam sem ler o corpo — mesmo padrão pré-existente em toda rota
    // do sidecar (`requireSession`/checagem de papel sempre vêm antes de
    // `readJsonBody`), não é algo que esta story mudou.
    const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
    const amountCents = body?.amountCents;
    if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents <= 0) {
      sendJson(res, 400, { error: config.amountErrorMessage });
      return;
    }
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (reason.length === 0) {
      sendJson(res, 400, { error: config.reasonErrorMessage });
      return;
    }

    const state = ctx.currentState();
    const openSession = state.cashSessions.find((s) => s.mergedInto === undefined && s.status === "open");
    if (!openSession) {
      sendJson(res, 400, { error: "nenhuma sessão de caixa aberta" });
      return;
    }

    const event = DomainEventSchema.parse({
      id: randomUUID(),
      hlc: nextHlc(),
      operatorId: acting.id,
      terminalId: ctx.terminalId,
      createdAt: Date.now(),
      type: config.eventType,
      aggregateType: "cash_session",
      aggregateId: openSession.id,
      payload: { amountCents, reason },
    });
    insertEvent(ctx.db, event);
    sendJson(res, 201, { id: event.id, amountCents, reason, recordedAt: event.createdAt });
  } catch {
    sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
  }
}

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

  if (req.method === "POST" && url.pathname === "/cash-sessions/withdrawals") {
    await handleCashMovementRoute(req, res, ctx, {
      eventType: "cash_withdrawal_recorded",
      roleErrorMessage: "garçom não pode registrar sangria",
      amountErrorMessage: "valor da sangria inválido",
      reasonErrorMessage: "motivo da sangria é obrigatório",
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/cash-sessions/deposits") {
    await handleCashMovementRoute(req, res, ctx, {
      eventType: "cash_deposit_recorded",
      roleErrorMessage: "garçom não pode registrar suprimento",
      amountErrorMessage: "valor do suprimento inválido",
      reasonErrorMessage: "motivo do suprimento é obrigatório",
    });
    return true;
  }

  return false;
}

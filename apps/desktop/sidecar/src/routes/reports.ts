import type http from "node:http";
import { computeCashRegisterSummaryForRange, countCanceledItemsByOperator } from "@passa-a-regua/sync-engine";
import { sendJson } from "../http-helpers.js";
import type { RequestContext } from "../context.js";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" -> epoch ms em UTC, meio-dia irrelevante aqui — só usado pra aritmética de DIAS entre chaves, nunca comparado com `createdAt` real de evento. */
function dateKeyToUtcDayMs(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const shifted = new Date(dateKeyToUtcDayMs(dateKey) + deltaDays * MS_PER_DAY);
  const year = String(shifted.getUTCFullYear()).padStart(4, "0");
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Round-trip via UTC (reaproveita `shiftDateKey` com delta 0) — rejeita
 * data com formato certo mas calendarialmente inválida (ex: `2026-02-30`,
 * que `Date.UTC` rolaria silenciosamente pra `2026-03-02` em vez de
 * recusar) e também o quirk de ano de 1-3 dígitos (`Date.UTC` remapeia
 * `0-99` pra `1900+ano`) — em ambos os casos a chave reformatada não bate
 * com a original.
 */
function isValidCalendarDateKey(dateKey: string): boolean {
  return shiftDateKey(dateKey, 0) === dateKey;
}

type DateRangeResult = { ok: true; from: string; to: string } | { ok: false; error: string };

/**
 * Épico 2 (Story 2.2) — extraído da validação que já existia inline na rota
 * da Story 2.1 abaixo, agora reaproveitado pelas DUAS rotas deste arquivo:
 * presença de `from`/`to`, formato `YYYY-MM-DD`, `from <= to` e calendário
 * válido (rejeita `2026-02-30`). Corpo/query sempre lido e validado ANTES de
 * qualquer cálculo (AC literal — achado no code review, 2026-09-29: essa regra
 * não é NFR7, que é sobre dinheiro em centavos; a spec-2-2 não dá tag NFR a ela).
 */
function parseDateRange(url: URL): DateRangeResult {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) {
    return { ok: false, error: "intervalo de datas obrigatório" };
  }
  if (
    !DATE_KEY_PATTERN.test(from) ||
    !DATE_KEY_PATTERN.test(to) ||
    from > to ||
    !isValidCalendarDateKey(from) ||
    !isValidCalendarDateKey(to)
  ) {
    return { ok: false, error: "intervalo de datas inválido" };
  }
  return { ok: true, from, to };
}

/**
 * Épico 2 (Story 2.1) — relatório por período, owner-only. Rota em arquivo
 * PRÓPRIO (não em `state.ts`, que serve `/cash-register/summary` sem
 * NENHUM controle de papel/sessão — resquício pré-Epic-1, não o padrão a
 * seguir numa rota nova). `requireSession` + bloqueio inline de
 * "waiter"/"cashier" (só "owner" passa) — mesmo padrão já estabelecido em
 * `cash-sessions.ts`, sem adicionar um helper novo em `context.ts`.
 *
 * `GET /reports/cash-register/range?from=&to=` devolve num ÚNICO payload o
 * resumo do intervalo pedido (`current`) e o do período equivalente
 * IMEDIATAMENTE anterior (`previous`, mesma duração em dias, sem semântica
 * de calendário) — evita uma segunda viagem de rede do frontend.
 */
export async function handleReportRoutes(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: RequestContext): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/reports/cash-register/range") {
    const acting = ctx.requireSession(res);
    if (!acting) return true;
    // Épico 2 — acesso restrito ao dono; garçom e caixa não têm nenhuma
    // visão além do resumo do dia atual (Épico 6).
    if (acting.role !== "owner") {
      sendJson(res, 403, { error: "acesso restrito ao dono" });
      return true;
    }

    // Corpo/query lido e validado ANTES de qualquer cálculo.
    const range = parseDateRange(url);
    if (!range.ok) {
      sendJson(res, 400, { error: range.error });
      return true;
    }
    const { from, to } = range;

    const orders = ctx.currentState().orders;
    const current = computeCashRegisterSummaryForRange(orders, from, to);

    // "Período anterior" = mesma duração em dias do intervalo escolhido,
    // deslocada imediatamente pra trás de `from` — regra única, sem
    // semântica de calendário civil (Design Notes de spec-2-1).
    const durationDays = Math.round((dateKeyToUtcDayMs(to) - dateKeyToUtcDayMs(from)) / MS_PER_DAY) + 1;
    // Achado no code review, 2026-09-28 (edge-case-hunter): os dois limites
    // do período anterior precisam ser derivados do `from` ORIGINAL (já
    // validado por `isValidCalendarDateKey`), nunca um do outro — encadear
    // `shiftDateKey(previousTo, ...)` reprocessa a STRING intermediária de
    // `previousTo` por `dateKeyToUtcDayMs`, e pra anos < 100 isso reaciona o
    // mesmo quirk de "ano de 2-3 dígitos" que a validação de entrada evita
    // (repro real: from=to="0100-01-01" produzia previousFrom="1999-12-31"
    // > previousTo="0099-12-31", um intervalo invertido devolvido como 200
    // vazio em vez de erro).
    const previousTo = shiftDateKey(from, -1);
    const previousFrom = shiftDateKey(from, -durationDays);
    const previous = computeCashRegisterSummaryForRange(orders, previousFrom, previousTo);

    sendJson(res, 200, { current, previous });
    return true;
  }

  /**
   * Épico 2 (Story 2.2) — relatório por operador, owner-only, mesmo padrão
   * de acesso/validação da rota acima. `GET
   * /reports/cash-register/by-operator?from=&to=` devolve, pra CADA operador
   * conhecido (mesmo os sem nenhuma atividade no período — Design Notes de
   * spec-2-2), o total vendido/comandas fechadas do intervalo e o total de
   * itens cancelados no mesmo intervalo. Filtro por operador acontece FORA
   * de `computeCashRegisterSummaryForRange` (ARCH §3.5/AC literal): esta
   * rota pré-filtra `orders` por `closing?.operatorId` antes de chamar o
   * helper — a função em si não sabe o que é "operador".
   */
  if (req.method === "GET" && url.pathname === "/reports/cash-register/by-operator") {
    const acting = ctx.requireSession(res);
    if (!acting) return true;
    if (acting.role !== "owner") {
      sendJson(res, 403, { error: "acesso restrito ao dono" });
      return true;
    }

    // Corpo/query lido e validado ANTES de qualquer cálculo.
    const range = parseDateRange(url);
    if (!range.ok) {
      sendJson(res, 400, { error: range.error });
      return true;
    }
    const { from, to } = range;

    const state = ctx.currentState();
    const canceledCounts = countCanceledItemsByOperator(state.orders, from, to);

    const byOperator = state.operators
      .map((operator) => {
        // Pré-filtro por `closing.operatorId`, não parâmetro do helper
        // compartilhado (`Never` da spec-2-2) — comandas ainda abertas nunca
        // têm `closing`, então não entram em nenhum agrupamento de vendas.
        const ordersClosedByOperator = state.orders.filter((o) => o.closing?.operatorId === operator.id);
        // Achado no code review, 2026-09-29 (blind-hunter): só `totalSoldCents`/
        // `closedOrdersCount` importam aqui — `subtotalCents`/`serviceFeeCents`/
        // `totalByPaymentMethod`/`pendingOrders` do `summary` são descartados de
        // propósito. Em especial, `summary.pendingOrders` SEMPRE vem `[]` nesta
        // chamada (todo item de `ordersClosedByOperator` já tem `closing`, então
        // nenhum está `status: "open"`) — não é um bug, mas não confie nesse
        // campo se um dia reaproveitar este `summary` pra outra coisa.
        const summary = computeCashRegisterSummaryForRange(ordersClosedByOperator, from, to);
        return {
          operatorId: operator.id,
          operatorName: operator.name,
          totalSoldCents: summary.totalSoldCents,
          closedOrdersCount: summary.closedOrdersCount,
          itemsCanceledCount: canceledCounts.get(operator.id) ?? 0,
        };
      })
      // Achado no code review, 2026-09-29 (blind-hunter): empate de
      // `totalSoldCents` (comum entre operadores sem nenhuma atividade —
      // exatamente o caso que o Design Notes destaca como importante pro
      // dono ver) ficava só na ordem incidental de `state.operators` (por
      // `id`). Desempate por nome, determinístico e legível.
      .sort((a, b) => b.totalSoldCents - a.totalSoldCents || a.operatorName.localeCompare(b.operatorName));

    sendJson(res, 200, byOperator);
    return true;
  }

  return false;
}

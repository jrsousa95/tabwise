import type http from "node:http";
import { computeCashRegisterSummaryForRange } from "@passa-a-regua/sync-engine";
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
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!from || !to) {
      sendJson(res, 400, { error: "intervalo de datas obrigatório" });
      return true;
    }
    if (
      !DATE_KEY_PATTERN.test(from) ||
      !DATE_KEY_PATTERN.test(to) ||
      from > to ||
      !isValidCalendarDateKey(from) ||
      !isValidCalendarDateKey(to)
    ) {
      sendJson(res, 400, { error: "intervalo de datas inválido" });
      return true;
    }

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

  return false;
}

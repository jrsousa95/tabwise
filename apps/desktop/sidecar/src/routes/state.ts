import type http from "node:http";
import { localDateKey, computeCashRegisterSummary } from "@tabwise/sync-engine";
import { sendJson } from "../http-helpers.js";
import type { RequestContext } from "../context.js";

// PRD 6.1 — resumo do dia calculado só da projeção local (nunca depende de
// sync com a nuvem estar em dia). `localDateKey`/`computeCashRegisterSummary`
// movidos pro sync-engine no M11 pra serem reaproveitados tal e qual pelo
// endpoint de relatório do backend (PRD 6.2) — ver `packages/sync-engine/src/reporting.ts`.

/** Projeção geral do estado (`/state`) e o resumo de caixa ao vivo (`/cash-register/summary`, Épico 6). */
export async function handleStateRoutes(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: RequestContext): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/state") {
    const state = ctx.currentState();
    // pinHash nunca deve sair pro frontend por essa via de leitura geral —
    // o log de eventos (/events) precisa carregar pra fins de sync (M9),
    // mas a UI não tem motivo nenhum pra ver o hash de ninguém.
    sendJson(res, 200, { ...state, operators: state.operators.map(({ pinHash: _pinHash, ...rest }) => rest) });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/cash-register/summary") {
    const dateKey = url.searchParams.get("date") ?? localDateKey(Date.now());
    sendJson(res, 200, computeCashRegisterSummary(ctx.currentState().orders, dateKey));
    return true;
  }

  return false;
}

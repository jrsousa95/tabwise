import type http from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { listEventsSinceCursor, project, sortEvents, type OperatorState, type OrderState, type ProjectedState } from "@tabwise/sync-engine";
import { sendJson } from "./http-helpers.js";
import { loadSession } from "./session.js";
import { loadOrCreateLanToken } from "./lan-pairing.js";
import { loadPlanCache } from "./plan-cache.js";

/**
 * Retrospectiva do MVP (M0-M12, `_bmad-output/implementation-artifacts/
 * retro-mvp-m0-m12-2026-09-21.md`) apontou `index.ts` como um arquivo
 * "deus" (1.269 linhas, 31 rotas inline) e recomendou quebrá-lo por
 * domínio. Este módulo carrega o estado e os helpers de autorização/
 * validação compartilhados por TODAS as rotas (`routes/*.ts`) — cada rota
 * recebe um único `RequestContext` em vez de importar `db`/`dataDir`
 * separadamente, o que manteria o acoplamento implícito que o arquivo
 * único tinha.
 */

export type Payment = { amountCents: number; paymentMethod: "cash" | "card" | "pix"; changeCents: number };
export type ParseSplitsResult = { ok: true; payments: Payment[] } | { ok: false; error: string };

export interface RequestContext {
  readonly db: DatabaseSync;
  readonly dataDir: string;
  readonly terminalId: string;
  currentState(): ProjectedState;
  currentOperators(): readonly OperatorState[];
  /** Qualquer operação que precise saber "quem está fazendo isso" (fora do bootstrap de `POST /operators`). */
  requireSession(res: http.ServerResponse): OperatorState | null;
  /** PRD 3.1/3.2/2.1 — só o dono cadastra categoria/produto/mesa. */
  requireOwner(res: http.ServerResponse): OperatorState | null;
  /**
   * M9 (ARCH §7) — pareamento tem uma exceção de bootstrap igual à de
   * `POST /operators`: um terminal novo não tem NENHUM operador até
   * sincronizar (os operadores chegam via sync, não são cadastrados de novo
   * em cada terminal). Sem essa exceção, um terminal novo nunca conseguiria
   * se parear — não tem quem logar como dono pra autorizar o pareamento que
   * é justamente o que traria os operadores. Depois que o terminal já tem
   * operadores (já se pareou uma vez, ou é o terminal original), volta a
   * exigir dono normalmente.
   */
  requireOwnerOrBootstrap(res: http.ServerResponse): boolean;
  /**
   * M9 (ARCH §7) — autentica requisições de OUTRO terminal no sync LAN (não
   * confundir com `requireSession`, que autentica o operador humano no
   * frontend local). Token compartilhado só entre terminais pareados —
   * qualquer outro dispositivo na rede Wi-Fi do bar é rejeitado.
   */
  requireLanToken(req: http.IncomingMessage, res: http.ServerResponse): boolean;
  /** M10 (ARCH §6, PRD 2.7/8.2) — lê o cache local do plano (atualizado a cada sync com a nuvem, `cloud-sync-client.ts`); nunca chama a nuvem em tempo real aqui, precisa funcionar 100% offline (NFR1). */
  maxConcurrentOrders(): number;
  isTableFree(state: ProjectedState, tableId: string): boolean;
  /** Épico 1 (Sessão de Caixa), Story 1.1 — invariante "uma sessão aberta por vez" do ESTABELECIMENTO inteiro (nunca por `terminalId`). Espelha `isTableFree`. */
  isCashSessionOpen(state: ProjectedState): boolean;
  /** PRD 5.1 — soma dos itens não cancelados; nunca confia num subtotal vindo do cliente. */
  computeSubtotalCents(order: OrderState): number;
  /** PRD 5.2 — divisão em partes iguais: resto da divisão inteira vai determinística pra primeira parcela. */
  distributeEqually(total: number, parts: number): number[];
  /** PRD 5.2/5.3/5.4 — valida as partes do split (soma exata obrigatória, sem tolerância) e calcula o troco de cada parte em dinheiro. */
  parseSplits(splitsInput: readonly unknown[], totalCents: number): ParseSplitsResult;
}

/**
 * M12 (ARCH §7, revisão de segurança) — comparação em tempo constante.
 * `!==` entre strings vaza timing (V8 costuma sair no primeiro byte
 * diferente), o que dá pra outro dispositivo na mesma rede Wi-Fi usar pra
 * adivinhar o token byte a byte; `timingSafeEqual` já era usado pro PIN
 * (`packages/sync-engine/src/auth.ts`) mas não tinha sido aplicado aqui.
 */
function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function createRequestContext(db: DatabaseSync, dataDir: string, terminalId: string): RequestContext {
  function currentState(): ProjectedState {
    return project(sortEvents(listEventsSinceCursor(db)));
  }

  function currentOperators(): readonly OperatorState[] {
    return currentState().operators;
  }

  function requireSession(res: http.ServerResponse): OperatorState | null {
    const session = loadSession(dataDir);
    const acting = currentOperators().find((o) => o.id === session?.operatorId);
    if (!acting) {
      sendJson(res, 401, { error: "faça login primeiro" });
      return null;
    }
    return acting;
  }

  function requireOwner(res: http.ServerResponse): OperatorState | null {
    const acting = requireSession(res);
    if (!acting) return null;
    if (acting.role !== "owner") {
      sendJson(res, 403, { error: "só o dono pode fazer isso" });
      return null;
    }
    return acting;
  }

  function requireOwnerOrBootstrap(res: http.ServerResponse): boolean {
    if (currentOperators().length === 0) return true;
    return requireOwner(res) !== null;
  }

  function requireLanToken(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    if (!token || !safeEquals(token, loadOrCreateLanToken(dataDir))) {
      sendJson(res, 401, { error: "token de pareamento LAN ausente ou inválido" });
      return false;
    }
    return true;
  }

  function maxConcurrentOrders(): number {
    return loadPlanCache(dataDir).maxConcurrentOrders;
  }

  function isTableFree(state: ProjectedState, tableId: string): boolean {
    return !state.orders.some((o) => o.mergedInto === undefined && o.status === "open" && o.currentTableId === tableId);
  }

  function isCashSessionOpen(state: ProjectedState): boolean {
    return state.cashSessions.some((s) => s.mergedInto === undefined && s.status === "open");
  }

  function computeSubtotalCents(order: OrderState): number {
    return order.items.filter((i) => !i.canceled).reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
  }

  function distributeEqually(total: number, parts: number): number[] {
    const base = Math.floor(total / parts);
    const result = new Array(parts).fill(base) as number[];
    result[0] += total - base * parts;
    return result;
  }

  function parseSplits(splitsInput: readonly unknown[], totalCents: number): ParseSplitsResult {
    // Achado em uso real, 2026-09-23: comanda aberta sem nenhum item lançado
    // (aberta por engano, ou com tudo cancelado) tem total R$ 0,00 — exigir
    // "ao menos uma parte" nesse caso é impossível de satisfazer, porque toda
    // parte também precisa ter valor > 0 (regra abaixo). Não há nada a
    // cobrar, então fechar sem nenhum `payment_recorded` é o comportamento
    // correto — só permitido quando o total é exatamente zero, nunca como
    // brecha pra fechar uma comanda com saldo sem registrar o pagamento.
    if (splitsInput.length === 0) {
      if (totalCents === 0) return { ok: true, payments: [] };
      return { ok: false, error: "informe ao menos uma parte do pagamento" };
    }

    const payments: Payment[] = [];
    let sum = 0;
    for (const raw of splitsInput) {
      const split = raw as Record<string, unknown> | null;
      const amountCents = split?.amountCents;
      const paymentMethod = split?.paymentMethod;
      if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents <= 0) {
        return { ok: false, error: "cada parte do split precisa de um valor inteiro positivo" };
      }
      if (paymentMethod !== "cash" && paymentMethod !== "card" && paymentMethod !== "pix") {
        return { ok: false, error: "forma de pagamento precisa ser 'cash', 'card' ou 'pix'" };
      }
      let changeCents = 0;
      if (paymentMethod === "cash") {
        const cashReceivedCents = split?.cashReceivedCents;
        if (typeof cashReceivedCents !== "number" || !Number.isInteger(cashReceivedCents) || cashReceivedCents < amountCents) {
          return { ok: false, error: "valor recebido em dinheiro precisa ser maior ou igual ao valor da parte" };
        }
        // PRD 5.4 — troco só se aplica à parte em dinheiro.
        changeCents = cashReceivedCents - amountCents;
      }
      payments.push({ amountCents, paymentMethod, changeCents });
      sum += amountCents;
    }
    // PRD 5.2 — sem faixa de tolerância, a soma precisa bater exata.
    if (sum !== totalCents) {
      return { ok: false, error: `soma das partes (${sum}) precisa ser exatamente igual ao total (${totalCents})` };
    }
    return { ok: true, payments };
  }

  return {
    db,
    dataDir,
    terminalId,
    currentState,
    currentOperators,
    requireSession,
    requireOwner,
    requireOwnerOrBootstrap,
    requireLanToken,
    maxConcurrentOrders,
    isTableFree,
    isCashSessionOpen,
    computeSubtotalCents,
    distributeEqually,
    parseSplits,
  };
}

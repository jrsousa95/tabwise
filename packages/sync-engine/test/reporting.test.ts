import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@passa-a-regua/shared-types";
import { serialize, tick, ZERO } from "../src/hlc.js";
import { project, sortEvents } from "../src/reconciliation.js";
import { computeCashRegisterSummary, computeExpectedCashSessionAmountCents, localDateKey } from "../src/reporting.js";

/** 2026-01-15 12:00:00 UTC — usado como wall-clock fixo pros testes (evita depender do fuso da máquina que roda o teste). */
const DAY_1 = Date.UTC(2026, 0, 15, 12, 0, 0);
const DAY_2 = Date.UTC(2026, 0, 16, 12, 0, 0);

let hlcCounter = 0;
function nextHlc(): string {
  return serialize(tick(ZERO, ++hlcCounter));
}

function orderOpened(id: string, tableId: string, createdAt: number): DomainEvent {
  return {
    id: `${id}-opened`,
    hlc: nextHlc(),
    aggregateType: "order",
    aggregateId: id,
    type: "order_opened",
    terminalId: "T1",
    operatorId: "op-1",
    createdAt,
    payload: { source: "table", tableId },
  };
}

function orderClosed(id: string, createdAt: number, totals: { subtotalCents: number; serviceFeeCents: number; totalCents: number }): DomainEvent {
  return {
    id: `${id}-closed`,
    hlc: nextHlc(),
    aggregateType: "order",
    aggregateId: id,
    type: "order_closed",
    terminalId: "T1",
    operatorId: "op-1",
    createdAt,
    payload: { subtotalCents: totals.subtotalCents, serviceFeePercent: 10, serviceFeeCents: totals.serviceFeeCents, totalCents: totals.totalCents },
  };
}

function paymentRecorded(id: string, createdAt: number, amountCents: number, paymentMethod: "cash" | "card" | "pix"): DomainEvent {
  return {
    id: `${id}-payment-${paymentMethod}`,
    hlc: nextHlc(),
    aggregateType: "order",
    aggregateId: id,
    type: "payment_recorded",
    terminalId: "T1",
    operatorId: "op-1",
    createdAt,
    payload: { amountCents, paymentMethod, changeCents: 0 },
  };
}

function cashSessionOpened(id: string, createdAt: number, openingAmountCents: number): DomainEvent {
  return {
    id: `${id}-opened`,
    hlc: nextHlc(),
    aggregateType: "cash_session",
    aggregateId: id,
    type: "cash_session_opened",
    terminalId: "T1",
    operatorId: "op-1",
    createdAt,
    payload: { openingAmountCents },
  };
}

function cashSessionClosed(id: string, createdAt: number, countedAmountCents: number): DomainEvent {
  return {
    id: `${id}-closed`,
    hlc: nextHlc(),
    aggregateType: "cash_session",
    aggregateId: id,
    type: "cash_session_closed",
    terminalId: "T1",
    operatorId: "op-1",
    createdAt,
    payload: { countedAmountCents },
  };
}

function cashWithdrawalRecorded(sessionId: string, createdAt: number, amountCents: number): DomainEvent {
  return {
    id: `${sessionId}-withdrawal-${createdAt}`,
    hlc: nextHlc(),
    aggregateType: "cash_session",
    aggregateId: sessionId,
    type: "cash_withdrawal_recorded",
    terminalId: "T1",
    operatorId: "op-1",
    createdAt,
    payload: { amountCents, reason: "teste" },
  };
}

function cashDepositRecorded(sessionId: string, createdAt: number, amountCents: number): DomainEvent {
  return {
    id: `${sessionId}-deposit-${createdAt}`,
    hlc: nextHlc(),
    aggregateType: "cash_session",
    aggregateId: sessionId,
    type: "cash_deposit_recorded",
    terminalId: "T1",
    operatorId: "op-1",
    createdAt,
    payload: { amountCents, reason: "teste" },
  };
}

describe("localDateKey (PRD 6.1)", () => {
  it("formata epoch ms como YYYY-MM-DD no fuso local", () => {
    expect(localDateKey(DAY_1)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("computeCashRegisterSummary (PRD 6.1/6.2)", () => {
  it("sem nenhuma comanda, resumo do dia é zerado e sem pendentes", () => {
    const summary = computeCashRegisterSummary([], "2026-01-15");
    expect(summary).toEqual({
      date: "2026-01-15",
      closedOrdersCount: 0,
      subtotalCents: 0,
      serviceFeeCents: 0,
      totalSoldCents: 0,
      totalByPaymentMethod: { cash: 0, card: 0, pix: 0 },
      pendingOrders: [],
    });
  });

  it("soma comandas fechadas no dia, separa pendentes e nunca conta comanda mesclada perdedora", () => {
    const events: DomainEvent[] = [
      orderOpened("closed-1", "table-1", DAY_1),
      orderClosed("closed-1", DAY_1, { subtotalCents: 1000, serviceFeeCents: 100, totalCents: 1100 }),
      paymentRecorded("closed-1", DAY_1, 1100, "cash"),

      orderOpened("closed-2", "table-2", DAY_1),
      orderClosed("closed-2", DAY_1, { subtotalCents: 2000, serviceFeeCents: 200, totalCents: 2200 }),
      paymentRecorded("closed-2", DAY_1, 1200, "cash"),
      paymentRecorded("closed-2", DAY_1, 500, "card"),
      paymentRecorded("closed-2", DAY_1, 500, "pix"),

      // Fechada em outro dia — não deve entrar no resumo de DAY_1.
      orderOpened("closed-other-day", "table-3", DAY_2),
      orderClosed("closed-other-day", DAY_2, { subtotalCents: 5000, serviceFeeCents: 500, totalCents: 5500 }),
      paymentRecorded("closed-other-day", DAY_2, 5500, "card"),

      // Ainda aberta — vai pra "pendentes", nunca entra no total fechado.
      orderOpened("pending-1", "table-4", DAY_1),
    ];

    const state = project(sortEvents(events));
    const summary = computeCashRegisterSummary(state.orders, localDateKey(DAY_1));

    expect(summary.closedOrdersCount).toBe(2);
    expect(summary.subtotalCents).toBe(3000);
    expect(summary.serviceFeeCents).toBe(300);
    expect(summary.totalSoldCents).toBe(3300);
    expect(summary.totalByPaymentMethod).toEqual({ cash: 2300, card: 500, pix: 500 });
    expect(summary.pendingOrders).toEqual([{ id: "pending-1", origin: { source: "table", tableId: "table-4" }, currentTableId: "table-4" }]);
  });
});

describe("computeExpectedCashSessionAmountCents (Épico 1, Story 1.4)", () => {
  it("sem nenhuma venda/movimentação, o valor esperado é só o fundo de troco", () => {
    const state = project(sortEvents([cashSessionOpened("session-1", DAY_1, 5000)]));
    const session = state.cashSessions.find((s) => s.id === "session-1")!;
    expect(computeExpectedCashSessionAmountCents(session, state.orders, DAY_1 + 1000)).toBe(5000);
  });

  it("soma venda em dinheiro dentro da janela, ignora cartão/pix e venda fora da janela, soma suprimento e subtrai sangria", () => {
    const events: DomainEvent[] = [
      cashSessionOpened("session-1", DAY_1, 5000),

      // Venda em dinheiro DENTRO da janela — conta.
      orderOpened("order-cash-in", "table-1", DAY_1 + 1000),
      orderClosed("order-cash-in", DAY_1 + 1000, { subtotalCents: 1000, serviceFeeCents: 0, totalCents: 1000 }),
      paymentRecorded("order-cash-in", DAY_1 + 1000, 1000, "cash"),

      // Venda em CARTÃO dentro da janela — não conta pro valor esperado da gaveta.
      orderOpened("order-card-in", "table-2", DAY_1 + 1000),
      orderClosed("order-card-in", DAY_1 + 1000, { subtotalCents: 2000, serviceFeeCents: 0, totalCents: 2000 }),
      paymentRecorded("order-card-in", DAY_1 + 1000, 2000, "card"),

      cashWithdrawalRecorded("session-1", DAY_1 + 2000, 300),
      cashDepositRecorded("session-1", DAY_1 + 2000, 150),
    ];

    // Venda em dinheiro ANTES da sessão abrir — não pode contar (fora da janela).
    const orderBeforeWindow: DomainEvent[] = [
      orderOpened("order-cash-before", "table-3", DAY_1 - 5000),
      orderClosed("order-cash-before", DAY_1 - 5000, { subtotalCents: 4000, serviceFeeCents: 0, totalCents: 4000 }),
      paymentRecorded("order-cash-before", DAY_1 - 5000, 4000, "cash"),
    ];

    const state = project(sortEvents([...events, ...orderBeforeWindow]));
    const session = state.cashSessions.find((s) => s.id === "session-1")!;

    // 5000 (fundo) + 1000 (venda em dinheiro dentro da janela) + 150 (suprimento) - 300 (sangria) = 5850.
    expect(computeExpectedCashSessionAmountCents(session, state.orders, DAY_1 + 3000)).toBe(5850);
  });

  it("uma sessão já FECHADA usa a janela até closing.closedAt, não até agora — venda depois do fechamento não conta nessa leitura", () => {
    const events: DomainEvent[] = [
      cashSessionOpened("session-1", DAY_1, 5000),
      orderOpened("order-1", "table-1", DAY_1 + 1000),
      orderClosed("order-1", DAY_1 + 1000, { subtotalCents: 1000, serviceFeeCents: 0, totalCents: 1000 }),
      paymentRecorded("order-1", DAY_1 + 1000, 1000, "cash"),
      cashSessionClosed("session-1", DAY_1 + 2000, 6000),
      // Fechada depois de closedAt — mesmo sendo em dinheiro, não deveria contar
      // nesta leitura (é exatamente o caso que a próxima venda tardia simula).
      orderOpened("order-after-close", "table-2", DAY_1 + 9000),
      orderClosed("order-after-close", DAY_1 + 9000, { subtotalCents: 2000, serviceFeeCents: 0, totalCents: 2000 }),
      paymentRecorded("order-after-close", DAY_1 + 9000, 2000, "cash"),
    ];

    const state = project(sortEvents(events));
    const session = state.cashSessions.find((s) => s.id === "session-1")!;
    expect(session.status).toBe("closed");
    // 5000 + 1000 = 6000 — a venda de DAY_1+9000 (depois do fechamento em DAY_1+2000) não entra.
    expect(computeExpectedCashSessionAmountCents(session, state.orders, DAY_1 + 999999)).toBe(6000);
  });

  it("Acceptance Criteria 5 — venda em dinheiro que sincroniza DEPOIS do fechamento, mas com closedAt DENTRO da janela original, muda o valor esperado recalculado (nunca fica congelado)", () => {
    // Mesmo cenário real da história: terminal ficou offline, fechou uma
    // comanda em dinheiro DENTRO da janela da sessão (antes do fechamento do
    // caixa), mas esse evento só chega no log de quem fechou o caixa DEPOIS —
    // sincronização atrasada. `cash_session_closed` já foi processado sem
    // saber dessa venda.
    const baseEvents: DomainEvent[] = [
      cashSessionOpened("session-1", DAY_1, 5000),
      orderOpened("order-known", "table-1", DAY_1 + 1000),
      orderClosed("order-known", DAY_1 + 1000, { subtotalCents: 1000, serviceFeeCents: 0, totalCents: 1000 }),
      paymentRecorded("order-known", DAY_1 + 1000, 1000, "cash"),
      cashSessionClosed("session-1", DAY_1 + 5000, 6000),
    ];

    // Leitura ANTES da venda tardia chegar no log.
    const stateBefore = project(sortEvents(baseEvents));
    const sessionBefore = stateBefore.cashSessions.find((s) => s.id === "session-1")!;
    const expectedBefore = computeExpectedCashSessionAmountCents(sessionBefore, stateBefore.orders, Date.now());
    expect(expectedBefore).toBe(6000); // 5000 + 1000

    // A comanda em dinheiro fechou em DAY_1+3000 (DENTRO da janela [DAY_1, DAY_1+5000]),
    // mas o evento só sincroniza/chega no log agora — depois do cash_session_closed.
    const lateOrderEvents: DomainEvent[] = [
      orderOpened("order-late", "table-2", DAY_1 + 3000),
      orderClosed("order-late", DAY_1 + 3000, { subtotalCents: 800, serviceFeeCents: 0, totalCents: 800 }),
      paymentRecorded("order-late", DAY_1 + 3000, 800, "cash"),
    ];

    // Leitura DEPOIS da venda tardia chegar — mesma sessão, recalculada do zero.
    const stateAfter = project(sortEvents([...baseEvents, ...lateOrderEvents]));
    const sessionAfter = stateAfter.cashSessions.find((s) => s.id === "session-1")!;
    const expectedAfter = computeExpectedCashSessionAmountCents(sessionAfter, stateAfter.orders, Date.now());

    // O valor esperado MUDOU — nunca fica congelado no que foi calculado no
    // momento do fechamento (Design Notes de spec-1-4: "nunca um evento de
    // correção manual", a PRÓXIMA leitura já reflete o valor certo).
    expect(expectedAfter).toBe(6800); // 6000 + 800
    expect(expectedAfter).not.toBe(expectedBefore);

    // O fato físico contado (`countedAmountCents`) nunca muda — só o esperado
    // recalculado. A diferença muda de 0 pra -800 (faltou, porque a venda em
    // dinheiro que "deveria" ter sido contada não foi, já que ninguém sabia
    // dela no momento do fechamento).
    expect(sessionAfter.closing?.countedAmountCents).toBe(6000);
    expect(sessionAfter.closing?.countedAmountCents! - expectedAfter).toBe(-800);
  });
});

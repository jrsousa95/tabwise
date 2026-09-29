import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@passa-a-regua/shared-types";
import { serialize, tick, ZERO } from "../src/hlc.js";
import { project, sortEvents } from "../src/reconciliation.js";
import {
  computeCashRegisterSummary,
  computeCashRegisterSummaryForRange,
  computeExpectedCashSessionAmountCents,
  countCanceledItemsByOperator,
  localDateKey,
} from "../src/reporting.js";

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

function orderClosed(
  id: string,
  createdAt: number,
  totals: { subtotalCents: number; serviceFeeCents: number; totalCents: number },
  operatorId = "op-1"
): DomainEvent {
  return {
    id: `${id}-closed`,
    hlc: nextHlc(),
    aggregateType: "order",
    aggregateId: id,
    type: "order_closed",
    terminalId: "T1",
    operatorId,
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

function itemAdded(orderId: string, itemId: string, createdAt: number, unitPriceCents = 1000): DomainEvent {
  return {
    id: `${orderId}-${itemId}-added`,
    hlc: nextHlc(),
    aggregateType: "order",
    aggregateId: orderId,
    type: "item_added",
    terminalId: "T1",
    operatorId: "op-1",
    createdAt,
    payload: { itemId, name: "Item de teste", unitPriceCents, quantity: 1 },
  };
}

/** `operatorId` é quem CANCELOU o item (Épico 2, Story 2.2) — nem sempre o mesmo que abriu/fechou a order. */
function itemCanceled(orderId: string, itemId: string, createdAt: number, operatorId: string): DomainEvent {
  return {
    id: `${orderId}-${itemId}-canceled-${createdAt}`,
    hlc: nextHlc(),
    aggregateType: "order",
    aggregateId: orderId,
    type: "item_canceled",
    terminalId: "T1",
    operatorId,
    createdAt,
    payload: { itemId, reason: "other", note: "teste" },
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

describe("computeCashRegisterSummaryForRange (Épico 2, Story 2.1)", () => {
  // 4 dias consecutivos, todos ao meio-dia UTC (evita depender do fuso da
  // máquina que roda o teste): DAY_MINUS_2, DAY_MINUS_1 (período anterior,
  // 2 dias), DAY_0, DAY_1_RANGE (período atual, mesma duração de 2 dias).
  const DAY_MINUS_2 = Date.UTC(2026, 2, 1, 12, 0, 0); // 2026-03-01
  const DAY_MINUS_1 = Date.UTC(2026, 2, 2, 12, 0, 0); // 2026-03-02
  const DAY_0 = Date.UTC(2026, 2, 3, 12, 0, 0); // 2026-03-03
  const DAY_1_RANGE = Date.UTC(2026, 2, 4, 12, 0, 0); // 2026-03-04
  const DAY_2_RANGE = Date.UTC(2026, 2, 5, 12, 0, 0); // 2026-03-05 (fora dos dois períodos)

  it("bounds inclusivos: comanda fechada exatamente em `from` ou em `to` conta; um dia antes/depois fica de fora", () => {
    const events: DomainEvent[] = [
      // Fechada um dia ANTES do `from` — fora do intervalo.
      orderOpened("before-range", "table-1", DAY_MINUS_1),
      orderClosed("before-range", DAY_MINUS_1, { subtotalCents: 100, serviceFeeCents: 0, totalCents: 100 }),
      paymentRecorded("before-range", DAY_MINUS_1, 100, "cash"),

      // Fechada exatamente em `from` — bound inclusivo, conta.
      orderOpened("at-from", "table-2", DAY_0),
      orderClosed("at-from", DAY_0, { subtotalCents: 1000, serviceFeeCents: 100, totalCents: 1100 }),
      paymentRecorded("at-from", DAY_0, 1100, "cash"),

      // Fechada exatamente em `to` — bound inclusivo, conta.
      orderOpened("at-to", "table-3", DAY_1_RANGE),
      orderClosed("at-to", DAY_1_RANGE, { subtotalCents: 2000, serviceFeeCents: 200, totalCents: 2200 }),
      paymentRecorded("at-to", DAY_1_RANGE, 2200, "card"),

      // Fechada um dia DEPOIS do `to` — fora do intervalo.
      orderOpened("after-range", "table-4", DAY_2_RANGE),
      orderClosed("after-range", DAY_2_RANGE, { subtotalCents: 300, serviceFeeCents: 0, totalCents: 300 }),
      paymentRecorded("after-range", DAY_2_RANGE, 300, "pix"),
    ];

    const state = project(sortEvents(events));
    const summary = computeCashRegisterSummaryForRange(state.orders, localDateKey(DAY_0), localDateKey(DAY_1_RANGE));

    expect(summary.date).toBe("2026-03-03..2026-03-04");
    expect(summary.closedOrdersCount).toBe(2);
    expect(summary.subtotalCents).toBe(3000);
    expect(summary.serviceFeeCents).toBe(300);
    expect(summary.totalSoldCents).toBe(3300);
    expect(summary.totalByPaymentMethod).toEqual({ cash: 1100, card: 2200, pix: 0 });
  });

  it("`pendingOrders` nunca filtra pelo intervalo pedido — mostra toda comanda aberta agora, mesmo fechada fora ou aberta fora do período", () => {
    const events: DomainEvent[] = [
      // Aberta bem fora do intervalo pedido — ainda assim precisa aparecer em pendingOrders (retrato do agora).
      orderOpened("pending-outside-range", "table-5", DAY_MINUS_2),
    ];

    const state = project(sortEvents(events));
    const summary = computeCashRegisterSummaryForRange(state.orders, localDateKey(DAY_0), localDateKey(DAY_1_RANGE));

    expect(summary.pendingOrders).toEqual([
      { id: "pending-outside-range", origin: { source: "table", tableId: "table-5" }, currentTableId: "table-5" },
    ]);
  });

  it("período anterior (mesma duração, deslocado pra trás) não vaza pro período atual nem vice-versa, mesmo com fronteira adjacente", () => {
    const events: DomainEvent[] = [
      // Período ANTERIOR (2 dias: DAY_MINUS_2..DAY_MINUS_1).
      orderOpened("previous-1", "table-1", DAY_MINUS_2),
      orderClosed("previous-1", DAY_MINUS_2, { subtotalCents: 500, serviceFeeCents: 0, totalCents: 500 }),
      paymentRecorded("previous-1", DAY_MINUS_2, 500, "cash"),

      orderOpened("previous-2", "table-2", DAY_MINUS_1),
      orderClosed("previous-2", DAY_MINUS_1, { subtotalCents: 700, serviceFeeCents: 0, totalCents: 700 }),
      paymentRecorded("previous-2", DAY_MINUS_1, 700, "cash"),

      // Período ATUAL (mesma duração de 2 dias: DAY_0..DAY_1_RANGE), imediatamente adjacente ao anterior.
      orderOpened("current-1", "table-3", DAY_0),
      orderClosed("current-1", DAY_0, { subtotalCents: 1000, serviceFeeCents: 0, totalCents: 1000 }),
      paymentRecorded("current-1", DAY_0, 1000, "card"),

      orderOpened("current-2", "table-4", DAY_1_RANGE),
      orderClosed("current-2", DAY_1_RANGE, { subtotalCents: 1200, serviceFeeCents: 0, totalCents: 1200 }),
      paymentRecorded("current-2", DAY_1_RANGE, 1200, "card"),
    ];

    const state = project(sortEvents(events));

    const current = computeCashRegisterSummaryForRange(state.orders, localDateKey(DAY_0), localDateKey(DAY_1_RANGE));
    const previous = computeCashRegisterSummaryForRange(state.orders, localDateKey(DAY_MINUS_2), localDateKey(DAY_MINUS_1));

    expect(current.closedOrdersCount).toBe(2);
    expect(current.totalSoldCents).toBe(2200);
    expect(current.totalByPaymentMethod).toEqual({ cash: 0, card: 2200, pix: 0 });

    expect(previous.closedOrdersCount).toBe(2);
    expect(previous.totalSoldCents).toBe(1200);
    expect(previous.totalByPaymentMethod).toEqual({ cash: 1200, card: 0, pix: 0 });
  });

  it("não altera a assinatura nem o comportamento de computeCashRegisterSummary — mesmo resultado de antes pra um único dia", () => {
    const events: DomainEvent[] = [
      orderOpened("single-day", "table-1", DAY_0),
      orderClosed("single-day", DAY_0, { subtotalCents: 1000, serviceFeeCents: 100, totalCents: 1100 }),
      paymentRecorded("single-day", DAY_0, 1100, "cash"),
    ];
    const state = project(sortEvents(events));
    const dateKey = localDateKey(DAY_0);

    const daySummary = computeCashRegisterSummary(state.orders, dateKey);
    const rangeSummary = computeCashRegisterSummaryForRange(state.orders, dateKey, dateKey);

    expect(rangeSummary.closedOrdersCount).toBe(daySummary.closedOrdersCount);
    expect(rangeSummary.subtotalCents).toBe(daySummary.subtotalCents);
    expect(rangeSummary.serviceFeeCents).toBe(daySummary.serviceFeeCents);
    expect(rangeSummary.totalSoldCents).toBe(daySummary.totalSoldCents);
    expect(rangeSummary.totalByPaymentMethod).toEqual(daySummary.totalByPaymentMethod);
    expect(rangeSummary.pendingOrders).toEqual(daySummary.pendingOrders);
  });
});

describe("countCanceledItemsByOperator (Épico 2, Story 2.2)", () => {
  const DAY_A = Date.UTC(2026, 3, 1, 12, 0, 0); // 2026-04-01
  const DAY_B = Date.UTC(2026, 3, 2, 12, 0, 0); // 2026-04-02
  const DAY_C = Date.UTC(2026, 3, 3, 12, 0, 0); // 2026-04-03

  it("janela pelo `canceledAt` do item, não pelo `closedAt` da order — cancelamento numa order ainda ABERTA conta", () => {
    const events: DomainEvent[] = [
      orderOpened("order-open", "table-1", DAY_A),
      itemAdded("order-open", "item-1", DAY_A),
      // Cancelado dentro da janela — a order NUNCA fecha (sem order_closed nenhum no log).
      itemCanceled("order-open", "item-1", DAY_B, "op-2"),
    ];
    const state = project(sortEvents(events));
    const order = state.orders.find((o) => o.id === "order-open")!;
    expect(order.status).toBe("open"); // confirma que a order realmente segue aberta

    const counts = countCanceledItemsByOperator(state.orders, localDateKey(DAY_A), localDateKey(DAY_C));
    expect(counts.get("op-2")).toBe(1);
  });

  it("cancelamento atribuído ao operador que CANCELOU, independente de quem fechou a order", () => {
    const events: DomainEvent[] = [
      orderOpened("order-1", "table-1", DAY_A),
      itemAdded("order-1", "item-1", DAY_A),
      itemCanceled("order-1", "item-1", DAY_A, "op-cancel"),
      orderClosed("order-1", DAY_B, { subtotalCents: 0, serviceFeeCents: 0, totalCents: 0 }, "op-close"),
    ];
    const state = project(sortEvents(events));

    const counts = countCanceledItemsByOperator(state.orders, localDateKey(DAY_A), localDateKey(DAY_C));
    expect(counts.get("op-cancel")).toBe(1);
    expect(counts.has("op-close")).toBe(false);
  });

  it("cancelamento fora da janela (antes de `from` ou depois de `to`) não conta pra ninguém", () => {
    const events: DomainEvent[] = [
      orderOpened("order-1", "table-1", DAY_A),
      itemAdded("order-1", "item-1", DAY_A),
      itemAdded("order-1", "item-2", DAY_A),
      itemCanceled("order-1", "item-1", DAY_A, "op-early"), // antes de `from`
      itemCanceled("order-1", "item-2", DAY_C, "op-late"), // depois de `to`
    ];
    const state = project(sortEvents(events));

    const counts = countCanceledItemsByOperator(state.orders, localDateKey(DAY_B), localDateKey(DAY_B));
    expect(counts.get("op-early")).toBeUndefined();
    expect(counts.get("op-late")).toBeUndefined();
  });

  it("bounds inclusivos nas duas pontas, mesma regra de computeCashRegisterSummaryForRange", () => {
    const events: DomainEvent[] = [
      orderOpened("order-1", "table-1", DAY_A),
      itemAdded("order-1", "item-1", DAY_A),
      itemAdded("order-1", "item-2", DAY_A),
      itemCanceled("order-1", "item-1", DAY_A, "op-x"), // exatamente em `from`
      itemCanceled("order-1", "item-2", DAY_C, "op-x"), // exatamente em `to`
    ];
    const state = project(sortEvents(events));

    const counts = countCanceledItemsByOperator(state.orders, localDateKey(DAY_A), localDateKey(DAY_C));
    expect(counts.get("op-x")).toBe(2);
  });

  it("agrupa por operador diferente e ignora item nunca cancelado", () => {
    const events: DomainEvent[] = [
      orderOpened("order-1", "table-1", DAY_A),
      itemAdded("order-1", "item-1", DAY_A),
      itemAdded("order-1", "item-2", DAY_A),
      itemAdded("order-1", "item-3", DAY_A), // nunca cancelado
      itemCanceled("order-1", "item-1", DAY_B, "op-a"),
      itemCanceled("order-1", "item-2", DAY_B, "op-b"),
    ];
    const state = project(sortEvents(events));

    const counts = countCanceledItemsByOperator(state.orders, localDateKey(DAY_A), localDateKey(DAY_C));
    expect(counts.get("op-a")).toBe(1);
    expect(counts.get("op-b")).toBe(1);
    expect(counts.size).toBe(2); // item-3 (não cancelado) não gera nenhuma entrada
  });

  it("order mesclada PERDEDORA (ARCH §4.2) nunca conta — o item redirecionado só existe na canônica", () => {
    const events: DomainEvent[] = [
      orderOpened("order-canonical", "table-1", DAY_A),
      orderOpened("order-losing", "table-1", DAY_A + 1), // mesma mesa, HLC maior -> perde o conflito
      // Evento referencia a perdedora, mas `resolveCanonical` redireciona o item pra canônica.
      itemAdded("order-losing", "item-1", DAY_A),
      itemCanceled("order-losing", "item-1", DAY_B, "op-a"),
    ];
    const state = project(sortEvents(events));
    const losing = state.orders.find((o) => o.id === "order-losing")!;
    expect(losing.mergedInto).toBe("order-canonical");
    expect(losing.items).toEqual([]); // o item nunca fica na perdedora

    const counts = countCanceledItemsByOperator(state.orders, localDateKey(DAY_A), localDateKey(DAY_C));
    expect(counts.get("op-a")).toBe(1); // contado uma única vez, via canônica
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

  it("achado no code review (edge-case-hunter): sangria/suprimento registrado DEPOIS do fechamento (terminal offline que ainda via a sessão como aberta) não conta no valor esperado recalculado", () => {
    const events: DomainEvent[] = [
      cashSessionOpened("session-1", DAY_1, 5000),
      cashSessionClosed("session-1", DAY_1 + 2000, 5000),
      // Terminal offline registrou sangria/suprimento contra esta sessão
      // enquanto ainda a via como aberta localmente; só sincronizou DEPOIS
      // que outro terminal já tinha fechado (recordedAt > closedAt).
      cashWithdrawalRecorded("session-1", DAY_1 + 9000, 1000),
      cashDepositRecorded("session-1", DAY_1 + 9000, 2000),
    ];

    const state = project(sortEvents(events));
    const session = state.cashSessions.find((s) => s.id === "session-1")!;
    expect(session.status).toBe("closed");
    // Se a sangria/suprimento tardios contassem, seria 5000 - 1000 + 2000 = 6000.
    // Como aconteceram DEPOIS de closedAt (DAY_1+2000), ficam fora da janela — só o fundo de troco.
    expect(computeExpectedCashSessionAmountCents(session, state.orders, DAY_1 + 999999)).toBe(5000);
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

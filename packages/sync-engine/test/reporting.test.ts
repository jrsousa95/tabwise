import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@passa-a-regua/shared-types";
import { serialize, tick, ZERO } from "../src/hlc.js";
import { project, sortEvents } from "../src/reconciliation.js";
import { computeCashRegisterSummary, localDateKey } from "../src/reporting.js";

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

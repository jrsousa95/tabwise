import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@passa-a-regua/shared-types";
import { serialize, tick, ZERO } from "../src/hlc.js";
import { project, sortEvents } from "../src/reconciliation.js";

let counter = 0;
function newHlc(wall: number) {
  return serialize(tick(ZERO, wall + counter++));
}

describe("projeção — demais tipos de evento", () => {
  it("operator_registered materializa em `operators`", () => {
    const event: DomainEvent = {
      id: "ev-1",
      hlc: newHlc(1000),
      aggregateType: "operator",
      aggregateId: "op-1",
      type: "operator_registered",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { name: "Ana", role: "waiter", pinHash: "hash-123" },
    };
    const state = project(sortEvents([event]));
    expect(state.operators).toEqual([{ id: "op-1", name: "Ana", role: "waiter", pinHash: "hash-123" }]);
  });

  it("order_transferred muda a mesa atual e preserva itens/histórico (PRD 2.5)", () => {
    const open: DomainEvent = {
      id: "ev-1",
      hlc: newHlc(1000),
      aggregateType: "order",
      aggregateId: "c-1",
      type: "order_opened",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { source: "table", tableId: "table-1" },
    };
    const item: DomainEvent = {
      id: "ev-2",
      hlc: newHlc(1000),
      aggregateType: "order",
      aggregateId: "c-1",
      type: "item_added",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { itemId: "i-1", name: "Cerveja", unitPriceCents: 1000, quantity: 1 },
    };
    const transfer: DomainEvent = {
      id: "ev-3",
      hlc: newHlc(1000),
      aggregateType: "order",
      aggregateId: "c-1",
      type: "order_transferred",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { originTableId: "table-1", destinationTableId: "table-2" },
    };

    const state = project(sortEvents([open, item, transfer]));
    const order = state.orders.find((o) => o.id === "c-1")!;
    expect(order.currentTableId).toBe("table-2");
    expect(order.items).toHaveLength(1);
    expect(order.transfers).toEqual([{ originTableId: "table-1", destinationTableId: "table-2", hlc: transfer.hlc }]);

    // A mesa de origem fica livre pra uma nova order, sem conflito (PRD 2.5).
    const newOpen: DomainEvent = {
      id: "ev-4",
      hlc: newHlc(1000),
      aggregateType: "order",
      aggregateId: "c-2",
      type: "order_opened",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { source: "table", tableId: "table-1" },
    };
    const state2 = project(sortEvents([open, item, transfer, newOpen]));
    expect(state2.orders.find((o) => o.id === "c-2")?.mergedInto).toBeUndefined();
  });

  it("tables_grouped materializa em `tableGroups` sem mesclar dados de order (PRD 2.6)", () => {
    const event: DomainEvent = {
      id: "ev-1",
      hlc: newHlc(1000),
      aggregateType: "table_group",
      aggregateId: "g-1",
      type: "tables_grouped",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { tableIds: ["table-1", "table-2"] },
    };
    const state = project(sortEvents([event]));
    expect(state.tableGroups).toEqual([{ id: "g-1", tableIds: ["table-1", "table-2"] }]);
  });

  it("table_group_dissolved remove o grupo de `tableGroups`, sem apagar o evento original (PRD 2.6, emenda 2026-09-21)", () => {
    const grouped: DomainEvent = {
      id: "ev-1",
      hlc: newHlc(1000),
      aggregateType: "table_group",
      aggregateId: "g-1",
      type: "tables_grouped",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { tableIds: ["table-1", "table-2"] },
    };
    const dissolved: DomainEvent = {
      id: "ev-2",
      hlc: newHlc(2000),
      aggregateType: "table_group",
      aggregateId: "g-1",
      type: "table_group_dissolved",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 2000,
      payload: {},
    };
    const state = project(sortEvents([grouped, dissolved]));
    expect(state.tableGroups).toEqual([]);
  });

  it("order_closed marca status e guarda o resumo; payment_recorded acumula os splits (PRD 5.1-5.5)", () => {
    const open: DomainEvent = {
      id: "ev-1",
      hlc: newHlc(1000),
      aggregateType: "order",
      aggregateId: "c-1",
      type: "order_opened",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { source: "standalone", number: 1 },
    };
    const payment1: DomainEvent = {
      id: "ev-2",
      hlc: newHlc(1000),
      aggregateType: "order",
      aggregateId: "c-1",
      type: "payment_recorded",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { amountCents: 2000, paymentMethod: "cash", changeCents: 500 },
    };
    const payment2: DomainEvent = {
      id: "ev-3",
      hlc: newHlc(1000),
      aggregateType: "order",
      aggregateId: "c-1",
      type: "payment_recorded",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { amountCents: 1500, paymentMethod: "card", changeCents: 0 },
    };
    const closed: DomainEvent = {
      id: "ev-4",
      hlc: newHlc(1000),
      aggregateType: "order",
      aggregateId: "c-1",
      type: "order_closed",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { subtotalCents: 3000, serviceFeePercent: 10, serviceFeeCents: 300, totalCents: 3300 },
    };

    const state = project(sortEvents([open, payment1, payment2, closed]));
    const order = state.orders.find((o) => o.id === "c-1")!;
    expect(order.status).toBe("closed");
    expect(order.closing).toEqual({
      subtotalCents: 3000,
      serviceFeePercent: 10,
      serviceFeeCents: 300,
      totalCents: 3300,
      closedAt: 1000,
      // Épico 2 (Story 2.2) — retrofit aditivo: `ClosingState.operatorId` vem de `event.operatorId`.
      operatorId: "op-1",
    });
    expect(order.payments).toEqual([
      { amountCents: 2000, paymentMethod: "cash", changeCents: 500 },
      { amountCents: 1500, paymentMethod: "card", changeCents: 0 },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@passa-a-regua/shared-types";
import { serialize, tick, ZERO } from "../src/hlc.js";
import { project, sortEvents } from "../src/reconciliation.js";

let counter = 0;
function newHlc(wall: number) {
  return serialize(tick(ZERO, wall + counter++));
}

describe("projeção — mesas (PRD 2.1/2.5)", () => {
  it("table_registered materializa em `tables`", () => {
    const event: DomainEvent = {
      id: "ev-1",
      hlc: newHlc(1000),
      aggregateType: "table",
      aggregateId: "m-1",
      type: "table_registered",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { identifier: "Mesa 1", capacity: 4 },
    };
    const state = project(sortEvents([event]));
    expect(state.tables).toEqual([{ id: "m-1", identifier: "Mesa 1", capacity: 4 }]);
  });

  it("table_registered sem capacity fica com o campo undefined", () => {
    const event: DomainEvent = {
      id: "ev-1",
      hlc: newHlc(1000),
      aggregateType: "table",
      aggregateId: "m-1",
      type: "table_registered",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { identifier: "Balcão" },
    };
    const state = project(sortEvents([event]));
    expect(state.tables[0]!.capacity).toBeUndefined();
  });

  it("order_transferred move a mesa atual da order e libera a mesa de origem pra uma nova (PRD 2.5)", () => {
    const open: DomainEvent = {
      id: "ev-1",
      hlc: newHlc(1000),
      aggregateType: "order",
      aggregateId: "c-1",
      type: "order_opened",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { source: "table", tableId: "m-1" },
    };
    const transfer: DomainEvent = {
      id: "ev-2",
      hlc: newHlc(1000),
      aggregateType: "order",
      aggregateId: "c-1",
      type: "order_transferred",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { originTableId: "m-1", destinationTableId: "m-2" },
    };
    const reopenOriginTable: DomainEvent = {
      id: "ev-3",
      hlc: newHlc(1000),
      aggregateType: "order",
      aggregateId: "c-2",
      type: "order_opened",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { source: "table", tableId: "m-1" },
    };

    const state = project(sortEvents([open, transfer, reopenOriginTable]));
    const order = state.orders.find((o) => o.id === "c-1")!;
    expect(order.currentTableId).toBe("m-2");
    // A mesa de origem (m-1) ficou livre: a nova order nela não é conflito/merge.
    expect(state.orders.find((o) => o.id === "c-2")?.mergedInto).toBeUndefined();
  });
});

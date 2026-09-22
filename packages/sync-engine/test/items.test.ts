import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@passa-a-regua/shared-types";
import { serialize, tick, ZERO } from "../src/hlc.js";
import { project, sortEvents } from "../src/reconciliation.js";

let counter = 0;
function newHlc(wall: number) {
  return serialize(tick(ZERO, wall + counter++));
}

function openOrder(orderId: string): DomainEvent {
  return {
    id: `open-${orderId}`,
    hlc: newHlc(1000),
    aggregateType: "order",
    aggregateId: orderId,
    type: "order_opened",
    terminalId: "T1",
    operatorId: "op-1",
    createdAt: 1000,
    payload: { source: "standalone", number: 1 },
  };
}

describe("projeção — lançamento e cancelamento de item (PRD Épico 4/M6)", () => {
  it("item_canceled marca o item como cancelado e guarda motivo + observação (PRD 1.3/4.3)", () => {
    const opened = openOrder("c-1"); // avaliado antes dos demais de propósito — precisa do menor HLC
    const added: DomainEvent = {
      id: "ev-2",
      hlc: newHlc(1000),
      aggregateType: "order",
      aggregateId: "c-1",
      type: "item_added",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { itemId: "i-1", name: "Cerveja", unitPriceCents: 1200, quantity: 2, note: "bem gelada" },
    };
    const canceled: DomainEvent = {
      id: "ev-3",
      hlc: newHlc(1000),
      aggregateType: "order",
      aggregateId: "c-1",
      type: "item_canceled",
      terminalId: "T1",
      operatorId: "op-2",
      createdAt: 1000,
      payload: { itemId: "i-1", reason: "other", note: "cliente pediu troca" },
    };

    const state = project(sortEvents([opened, added, canceled]));
    const item = state.orders.find((o) => o.id === "c-1")!.items.find((i) => i.id === "i-1")!;

    expect(item.canceled).toBe(true);
    expect(item.cancelReason).toBe("other");
    expect(item.cancelNote).toBe("cliente pediu troca");
    // O evento original de adição nunca é reescrito — a observação do item
    // ("bem gelada") continua intacta, separada da observação do cancelamento.
    expect(item.note).toBe("bem gelada");
    expect(item.name).toBe("Cerveja");
    expect(item.quantity).toBe(2);
  });

  it("item_canceled pra um item que não existe na order não quebra a projeção", () => {
    const opened = openOrder("c-1"); // avaliado antes de propósito — precisa do menor HLC
    const canceled: DomainEvent = {
      id: "ev-2",
      hlc: newHlc(1000),
      aggregateType: "order",
      aggregateId: "c-1",
      type: "item_canceled",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { itemId: "item-que-nao-existe", reason: "entry_error" },
    };
    expect(() => project(sortEvents([opened, canceled]))).not.toThrow();
  });

  it("item_note_updated substitui a observação do item sem afetar nome/preço/quantidade (achado em uso real, 2026-09-22)", () => {
    const opened = openOrder("c-1");
    const added: DomainEvent = {
      id: "ev-2",
      hlc: newHlc(1000),
      aggregateType: "order",
      aggregateId: "c-1",
      type: "item_added",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { itemId: "i-1", name: "Cerveja", unitPriceCents: 1200, quantity: 2, note: "bem gelada" },
    };
    const noteUpdated: DomainEvent = {
      id: "ev-3",
      hlc: newHlc(1000),
      aggregateType: "order",
      aggregateId: "c-1",
      type: "item_note_updated",
      terminalId: "T1",
      operatorId: "op-2",
      createdAt: 1000,
      payload: { itemId: "i-1", note: "sem gelo" },
    };

    const state = project(sortEvents([opened, added, noteUpdated]));
    const item = state.orders.find((o) => o.id === "c-1")!.items.find((i) => i.id === "i-1")!;

    expect(item.note).toBe("sem gelo");
    expect(item.name).toBe("Cerveja");
    expect(item.quantity).toBe(2);
    expect(item.canceled).toBe(false);
  });

  it("item_note_updated pra um item que não existe na order não quebra a projeção", () => {
    const opened = openOrder("c-1");
    const noteUpdated: DomainEvent = {
      id: "ev-2",
      hlc: newHlc(1000),
      aggregateType: "order",
      aggregateId: "c-1",
      type: "item_note_updated",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { itemId: "item-que-nao-existe", note: "sem gelo" },
    };
    expect(() => project(sortEvents([opened, noteUpdated]))).not.toThrow();
  });
});

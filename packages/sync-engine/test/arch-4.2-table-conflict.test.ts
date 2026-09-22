import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@passa-a-regua/shared-types";
import { serialize, tick, ZERO } from "../src/hlc.js";
import { merge, project } from "../src/reconciliation.js";

/**
 * Reproduz literalmente o cenário do ARCH §4.2: o host cai; dois waiters em
 * terminais diferentes, sem se enxergarem na LAN, abrem cada um uma order
 * pra "table 5". Quando os logs se mesclam, a order de menor HLC vence, a
 * outra é mesclada automaticamente e os itens são reatribuídos.
 *
 * Portado do `spikes/spike-3-reconciliation/` — mesma lógica, agora sobre
 * o modelo de evento completo do `shared-types`.
 */
describe("ARCH §4.2 — duas orders abertas na mesma mesa", () => {
  it("a order de menor HLC é a canônica; a outra é mesclada e os itens são reatribuídos", () => {
    const clockT1Open = tick(ZERO, 1000);
    const orderOpenedT1: DomainEvent = {
      id: "ev-1",
      hlc: serialize(clockT1Open),
      aggregateType: "order",
      aggregateId: "order-A",
      type: "order_opened",
      terminalId: "T1",
      operatorId: "waiter-1",
      createdAt: 1000,
      payload: { source: "table", tableId: "table-5" },
    };
    const itemInOrderA: DomainEvent = {
      id: "ev-2",
      hlc: serialize(tick(clockT1Open, 1500)),
      aggregateType: "order",
      aggregateId: "order-A",
      type: "item_added",
      terminalId: "T1",
      operatorId: "waiter-1",
      createdAt: 1500,
      payload: { itemId: "item-beer", name: "Cerveja", unitPriceCents: 1200, quantity: 2 },
    };

    const clockT2Open = tick(ZERO, 2000);
    const orderOpenedT2: DomainEvent = {
      id: "ev-3",
      hlc: serialize(clockT2Open),
      aggregateType: "order",
      aggregateId: "order-B",
      type: "order_opened",
      terminalId: "T2",
      operatorId: "waiter-2",
      createdAt: 2000,
      payload: { source: "table", tableId: "table-5" },
    };
    const itemInOrderB: DomainEvent = {
      id: "ev-4",
      hlc: serialize(tick(clockT2Open, 2500)),
      aggregateType: "order",
      aggregateId: "order-B",
      type: "item_added",
      terminalId: "T2",
      operatorId: "waiter-2",
      createdAt: 2500,
      payload: { itemId: "item-water", name: "Água", unitPriceCents: 500, quantity: 1 },
    };

    const logT1 = [orderOpenedT1, itemInOrderA];
    const logT2 = [orderOpenedT2, itemInOrderB];
    const state = project(merge(logT1, logT2));

    const canonical = state.orders.find((o) => o.id === "order-A");
    const losing = state.orders.find((o) => o.id === "order-B");
    expect(canonical).toBeDefined();
    expect(losing).toBeDefined();

    expect(canonical!.mergedInto).toBeUndefined();
    expect(losing!.mergedInto).toBe("order-A");
    expect(canonical!.items.map((i) => i.id).sort()).toEqual(["item-beer", "item-water"]);
    expect(losing!.items).toEqual([]);

    expect(state.mergeWarnings).toEqual([{ losingOrder: "order-B", canonicalOrder: "order-A", tableId: "table-5", createdAt: 2000 }]);

    // A ordem em que os dois logs chegam pra merge não pode importar.
    expect(project(merge(logT2, logT1))).toEqual(state);
  });

  it("order avulsa nunca entra no conflito de mesa (não tem tableId)", () => {
    const openStandalone = (orderId: string, number: number, wall: number): DomainEvent => ({
      id: `open-${orderId}`,
      hlc: serialize(tick(ZERO, wall)),
      aggregateType: "order",
      aggregateId: orderId,
      type: "order_opened",
      terminalId: "T1",
      operatorId: "op",
      createdAt: wall,
      payload: { source: "standalone", number },
    });

    const state = project(merge([openStandalone("c-1", 7, 1000), openStandalone("c-2", 7, 2000)], []));
    // Duas orders avulsas com o mesmo número visível (colisão que a UI
    // deveria evitar na escrita) não geram merge — não há regra de conflito
    // de número avulso documentada no ARCH, só de mesa.
    expect(state.orders.find((o) => o.id === "c-1")?.mergedInto).toBeUndefined();
    expect(state.orders.find((o) => o.id === "c-2")?.mergedInto).toBeUndefined();
  });
});

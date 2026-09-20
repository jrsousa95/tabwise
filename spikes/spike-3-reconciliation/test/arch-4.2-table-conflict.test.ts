import { describe, expect, it } from "vitest";
import { serialize, tick, ZERO } from "../src/hlc";
import { merge, project } from "../src/reconciliation";
import type { DomainEvent } from "../src/events";

/**
 * Reproduz literalmente o cenário descrito no ARCH §4.2: o host cai; dois
 * waiters em terminais diferentes, sem se enxergarem na LAN, abrem cada um
 * uma order pra "table 5". Quando os logs se mesclam, a regra de
 * resolução precisa valer: a order de menor HLC (a que abriu primeiro)
 * vence, a outra é mesclada automaticamente e os itens são reatribuídos.
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
      payload: { tableId: "table-5" },
    };
    const itemInOrderA: DomainEvent = {
      id: "ev-2",
      hlc: serialize(tick(clockT1Open, 1500)),
      aggregateType: "order",
      aggregateId: "order-A",
      type: "item_added",
      terminalId: "T1",
      operatorId: "waiter-1",
      payload: { itemId: "item-beer", name: "Cerveja", quantity: 2 },
    };

    // T2, sem ver T1 (host fora do ar), abre a mesma mesa depois (HLC maior).
    const clockT2Open = tick(ZERO, 2000);
    const orderOpenedT2: DomainEvent = {
      id: "ev-3",
      hlc: serialize(clockT2Open),
      aggregateType: "order",
      aggregateId: "order-B",
      type: "order_opened",
      terminalId: "T2",
      operatorId: "waiter-2",
      payload: { tableId: "table-5" },
    };
    const itemInOrderB: DomainEvent = {
      id: "ev-4",
      hlc: serialize(tick(clockT2Open, 2500)),
      aggregateType: "order",
      aggregateId: "order-B",
      type: "item_added",
      terminalId: "T2",
      operatorId: "waiter-2",
      payload: { itemId: "item-water", name: "Água", quantity: 1 },
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

    // Itens das duas orders ficam visíveis na canônica (reatribuição).
    expect(canonical!.items.map((i) => i.id).sort()).toEqual(["item-beer", "item-water"]);
    expect(losing!.items).toEqual([]);

    // Base pro indicador não bloqueante que o terminal "perdedor" precisa mostrar.
    expect(state.mergeWarnings).toEqual([{ losingOrder: "order-B", canonicalOrder: "order-A", tableId: "table-5" }]);

    // A ordem em que os dois logs chegam pra merge não pode importar.
    const reversedOrderState = project(merge(logT2, logT1));
    expect(reversedOrderState).toEqual(state);
  });

  it("com três terminais conflitando na mesma mesa, todos os perdedores mesclam na mesma canônica (sem encadear)", () => {
    const open = (terminal: string, orderId: string, wall: number): DomainEvent => ({
      id: `open-${orderId}`,
      hlc: serialize(tick(ZERO, wall)),
      aggregateType: "order",
      aggregateId: orderId,
      type: "order_opened",
      terminalId: terminal,
      operatorId: "op",
      payload: { tableId: "table-9" },
    });

    const events = [open("T1", "order-A", 1000), open("T2", "order-B", 2000), open("T3", "order-C", 3000)];

    const state = project(merge(events, []));
    const byId = new Map(state.orders.map((o) => [o.id, o]));

    expect(byId.get("order-A")?.mergedInto).toBeUndefined();
    expect(byId.get("order-B")?.mergedInto).toBe("order-A");
    expect(byId.get("order-C")?.mergedInto).toBe("order-A"); // mescla direto na canônica, não em B
  });
});

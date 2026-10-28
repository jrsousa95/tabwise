import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@tabwise/shared-types";
import { serialize, tick, ZERO } from "../src/hlc.js";
import { merge, project, sortEvents } from "../src/reconciliation.js";

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

  // Achado real em uso, 2026-09-23: mesa fechada e reaberta depois (uso
  // normal, todo dia — cliente novo senta na mesma mesa) era tratada como
  // conflito com a comanda antiga já fechada, mesclando a nova comanda
  // silenciosamente numa comanda inutilizável. tableToCanonicalOrder não
  // era limpo em order_closed (só em order_transferred).
  it("reabrir a mesma mesa depois de fechar a comanda anterior NÃO é conflito", () => {
    const openA: DomainEvent = {
      id: "ev-open-a",
      hlc: serialize(tick(ZERO, 1000)),
      aggregateType: "order",
      aggregateId: "order-A",
      type: "order_opened",
      terminalId: "T1",
      operatorId: "op",
      createdAt: 1000,
      payload: { source: "table", tableId: "table-1" },
    };
    const closeA: DomainEvent = {
      id: "ev-close-a",
      hlc: serialize(tick(ZERO, 2000)),
      aggregateType: "order",
      aggregateId: "order-A",
      type: "order_closed",
      terminalId: "T1",
      operatorId: "op",
      createdAt: 2000,
      payload: { subtotalCents: 1000, serviceFeePercent: 10, serviceFeeCents: 100, totalCents: 1100 },
    };
    // Bem depois, mesmo terminal — segunda comanda do dia na mesma mesa.
    const openB: DomainEvent = {
      id: "ev-open-b",
      hlc: serialize(tick(ZERO, 3000)),
      aggregateType: "order",
      aggregateId: "order-B",
      type: "order_opened",
      terminalId: "T1",
      operatorId: "op",
      createdAt: 3000,
      payload: { source: "table", tableId: "table-1" },
    };

    const state = project(sortEvents([openA, closeA, openB]));

    const orderA = state.orders.find((o) => o.id === "order-A");
    const orderB = state.orders.find((o) => o.id === "order-B");
    expect(orderA?.status).toBe("closed");
    expect(orderB?.status).toBe("open");
    expect(orderB?.mergedInto).toBeUndefined(); // não pode ser mesclada na comanda velha
    expect(state.mergeWarnings).toEqual([]); // nenhum conflito de verdade aconteceu
  });

  // Achado em uso real, 2026-09-23: o dono queria uma forma de reconhecer
  // que já revisou um conflito, sem ele ficar pra sempre marcado como
  // pendente — table_conflict_resolved é a resposta (append-only, não desfaz
  // o merge em si).
  describe("table_conflict_resolved", () => {
    function conflictingOrders(): DomainEvent[] {
      return [
        {
          id: "ev-1",
          hlc: serialize(tick(ZERO, 1000)),
          aggregateType: "order",
          aggregateId: "order-A",
          type: "order_opened",
          terminalId: "T1",
          operatorId: "waiter-1",
          createdAt: 1000,
          payload: { source: "table", tableId: "table-5" },
        },
        {
          id: "ev-2",
          hlc: serialize(tick(ZERO, 2000)),
          aggregateType: "order",
          aggregateId: "order-B",
          type: "order_opened",
          terminalId: "T2",
          operatorId: "waiter-2",
          createdAt: 2000,
          payload: { source: "table", tableId: "table-5" },
        },
      ];
    }

    it("marca o mergeWarning com resolvedAt quando o dono resolve o conflito", () => {
      const resolveEvent: DomainEvent = {
        id: "ev-3",
        hlc: serialize(tick(ZERO, 3000)),
        aggregateType: "order",
        aggregateId: "order-B", // sempre a losingOrder, nunca a canônica
        type: "table_conflict_resolved",
        terminalId: "T1",
        operatorId: "owner-1",
        createdAt: 3000,
        payload: {},
      };

      const state = project(sortEvents([...conflictingOrders(), resolveEvent]));
      expect(state.mergeWarnings).toEqual([
        { losingOrder: "order-B", canonicalOrder: "order-A", tableId: "table-5", createdAt: 2000, resolvedAt: 3000 },
      ]);
    });

    it("não importa se o evento de resolução chega antes do conflito no log (ordem de HLC não garante isso)", () => {
      const resolveEvent: DomainEvent = {
        id: "ev-resolve-first",
        hlc: serialize(tick(ZERO, 500)), // HLC menor que os dois order_opened
        aggregateType: "order",
        aggregateId: "order-B",
        type: "table_conflict_resolved",
        terminalId: "T1",
        operatorId: "owner-1",
        createdAt: 500,
        payload: {},
      };

      const state = project(sortEvents([resolveEvent, ...conflictingOrders()]));
      expect(state.mergeWarnings[0]?.resolvedAt).toBe(500);
    });

    it("conflito sem resolução não carrega resolvedAt", () => {
      const state = project(sortEvents(conflictingOrders()));
      expect(state.mergeWarnings[0]?.resolvedAt).toBeUndefined();
    });
  });
});

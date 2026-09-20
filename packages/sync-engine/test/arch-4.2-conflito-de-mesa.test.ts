import { describe, expect, it } from "vitest";
import type { Evento } from "@passa-a-regua/shared-types";
import { serialize, tick, ZERO } from "../src/hlc.js";
import { merge, projetar } from "../src/reconciliation.js";

/**
 * Reproduz literalmente o cenário do ARCH §4.2: o host cai; dois garçons em
 * terminais diferentes, sem se enxergarem na LAN, abrem cada um uma comanda
 * pra "mesa 5". Quando os logs se mesclam, a comanda de menor HLC vence, a
 * outra é mesclada automaticamente e os itens são reatribuídos.
 *
 * Portado do `spikes/spike-3-reconciliation/` — mesma lógica, agora sobre
 * o modelo de evento completo do `shared-types`.
 */
describe("ARCH §4.2 — duas comandas abertas na mesma mesa", () => {
  it("a comanda de menor HLC é a canônica; a outra é mesclada e os itens são reatribuídos", () => {
    const clockT1Abrir = tick(ZERO, 1000);
    const comandaAbertaT1: Evento = {
      id: "ev-1",
      hlc: serialize(clockT1Abrir),
      aggregateType: "comanda",
      aggregateId: "comanda-A",
      tipo: "comanda_aberta",
      terminalId: "T1",
      operadorId: "garcom-1",
      criadoEm: 1000,
      payload: { origem: "mesa", mesaId: "mesa-5" },
    };
    const itemNaComandaA: Evento = {
      id: "ev-2",
      hlc: serialize(tick(clockT1Abrir, 1500)),
      aggregateType: "comanda",
      aggregateId: "comanda-A",
      tipo: "item_adicionado",
      terminalId: "T1",
      operadorId: "garcom-1",
      criadoEm: 1500,
      payload: { itemId: "item-cerveja", nome: "Cerveja", precoUnitarioCentavos: 1200, quantidade: 2 },
    };

    const clockT2Abrir = tick(ZERO, 2000);
    const comandaAbertaT2: Evento = {
      id: "ev-3",
      hlc: serialize(clockT2Abrir),
      aggregateType: "comanda",
      aggregateId: "comanda-B",
      tipo: "comanda_aberta",
      terminalId: "T2",
      operadorId: "garcom-2",
      criadoEm: 2000,
      payload: { origem: "mesa", mesaId: "mesa-5" },
    };
    const itemNaComandaB: Evento = {
      id: "ev-4",
      hlc: serialize(tick(clockT2Abrir, 2500)),
      aggregateType: "comanda",
      aggregateId: "comanda-B",
      tipo: "item_adicionado",
      terminalId: "T2",
      operadorId: "garcom-2",
      criadoEm: 2500,
      payload: { itemId: "item-agua", nome: "Água", precoUnitarioCentavos: 500, quantidade: 1 },
    };

    const logT1 = [comandaAbertaT1, itemNaComandaA];
    const logT2 = [comandaAbertaT2, itemNaComandaB];
    const estado = projetar(merge(logT1, logT2));

    const canonica = estado.comandas.find((c) => c.id === "comanda-A");
    const perdedora = estado.comandas.find((c) => c.id === "comanda-B");
    expect(canonica).toBeDefined();
    expect(perdedora).toBeDefined();

    expect(canonica!.mescladaEm).toBeUndefined();
    expect(perdedora!.mescladaEm).toBe("comanda-A");
    expect(canonica!.itens.map((i) => i.id).sort()).toEqual(["item-agua", "item-cerveja"]);
    expect(perdedora!.itens).toEqual([]);

    expect(estado.avisosDeMerge).toEqual([
      { comandaPerdedora: "comanda-B", comandaCanonica: "comanda-A", mesaId: "mesa-5" },
    ]);

    // A ordem em que os dois logs chegam pra merge não pode importar.
    expect(projetar(merge(logT2, logT1))).toEqual(estado);
  });

  it("comanda avulsa nunca entra no conflito de mesa (não tem mesaId)", () => {
    const abrirAvulsa = (comandaId: string, numero: number, wall: number): Evento => ({
      id: `abrir-${comandaId}`,
      hlc: serialize(tick(ZERO, wall)),
      aggregateType: "comanda",
      aggregateId: comandaId,
      tipo: "comanda_aberta",
      terminalId: "T1",
      operadorId: "op",
      criadoEm: wall,
      payload: { origem: "avulsa", numero },
    });

    const estado = projetar(merge([abrirAvulsa("c-1", 7, 1000), abrirAvulsa("c-2", 7, 2000)], []));
    // Dois avulsos com o mesmo número visível (colisão que a UI deveria
    // evitar na escrita) não geram merge — não há regra de conflito de
    // número avulso documentada no ARCH, só de mesa.
    expect(estado.comandas.find((c) => c.id === "c-1")?.mescladaEm).toBeUndefined();
    expect(estado.comandas.find((c) => c.id === "c-2")?.mescladaEm).toBeUndefined();
  });
});

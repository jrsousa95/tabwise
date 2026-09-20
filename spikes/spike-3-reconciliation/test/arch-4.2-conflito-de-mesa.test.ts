import { describe, expect, it } from "vitest";
import { serialize, tick, ZERO } from "../src/hlc";
import { merge, projetar } from "../src/reconciliation";
import type { Evento } from "../src/events";

/**
 * Reproduz literalmente o cenário descrito no ARCH §4.2: o host cai; dois
 * garçons em terminais diferentes, sem se enxergarem na LAN, abrem cada um
 * uma comanda pra "mesa 5". Quando os logs se mesclam, a regra de
 * resolução precisa valer: a comanda de menor HLC (a que abriu primeiro)
 * vence, a outra é mesclada automaticamente e os itens são reatribuídos.
 */
describe("ARCH §4.2 — duas comandas abertas na mesma mesa", () => {
  it("a comanda de menor HLC é a canônica; a outra é mesclada e os itens são reatribuídos", () => {
    const clockT1_abrir = tick(ZERO, 1000);
    const comandaAbertaT1: Evento = {
      id: "ev-1",
      hlc: serialize(clockT1_abrir),
      aggregateType: "comanda",
      aggregateId: "comanda-A",
      tipo: "comanda_aberta",
      terminalId: "T1",
      operadorId: "garcom-1",
      payload: { mesaId: "mesa-5" },
    };
    const itemNaComandaA: Evento = {
      id: "ev-2",
      hlc: serialize(tick(clockT1_abrir, 1500)),
      aggregateType: "comanda",
      aggregateId: "comanda-A",
      tipo: "item_adicionado",
      terminalId: "T1",
      operadorId: "garcom-1",
      payload: { itemId: "item-cerveja", nome: "Cerveja", quantidade: 2 },
    };

    // T2, sem ver T1 (host fora do ar), abre a mesma mesa depois (HLC maior).
    const clockT2_abrir = tick(ZERO, 2000);
    const comandaAbertaT2: Evento = {
      id: "ev-3",
      hlc: serialize(clockT2_abrir),
      aggregateType: "comanda",
      aggregateId: "comanda-B",
      tipo: "comanda_aberta",
      terminalId: "T2",
      operadorId: "garcom-2",
      payload: { mesaId: "mesa-5" },
    };
    const itemNaComandaB: Evento = {
      id: "ev-4",
      hlc: serialize(tick(clockT2_abrir, 2500)),
      aggregateType: "comanda",
      aggregateId: "comanda-B",
      tipo: "item_adicionado",
      terminalId: "T2",
      operadorId: "garcom-2",
      payload: { itemId: "item-agua", nome: "Água", quantidade: 1 },
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

    // Itens das duas comandas ficam visíveis na canônica (reatribuição).
    expect(canonica!.itens.map((i) => i.id).sort()).toEqual(["item-agua", "item-cerveja"]);
    expect(perdedora!.itens).toEqual([]);

    // Base pro indicador não bloqueante que o terminal "perdedor" precisa mostrar.
    expect(estado.avisosDeMerge).toEqual([
      { comandaPerdedora: "comanda-B", comandaCanonica: "comanda-A", mesaId: "mesa-5" },
    ]);

    // A ordem em que os dois logs chegam pra merge não pode importar.
    const estadoOrdemInvertida = projetar(merge(logT2, logT1));
    expect(estadoOrdemInvertida).toEqual(estado);
  });

  it("com três terminais conflitando na mesma mesa, todos os perdedores mesclam na mesma canônica (sem encadear)", () => {
    const abrir = (terminal: string, comandaId: string, wall: number): Evento => ({
      id: `abrir-${comandaId}`,
      hlc: serialize(tick(ZERO, wall)),
      aggregateType: "comanda",
      aggregateId: comandaId,
      tipo: "comanda_aberta",
      terminalId: terminal,
      operadorId: "op",
      payload: { mesaId: "mesa-9" },
    });

    const eventos = [abrir("T1", "comanda-A", 1000), abrir("T2", "comanda-B", 2000), abrir("T3", "comanda-C", 3000)];

    const estado = projetar(merge(eventos, []));
    const porId = new Map(estado.comandas.map((c) => [c.id, c]));

    expect(porId.get("comanda-A")?.mescladaEm).toBeUndefined();
    expect(porId.get("comanda-B")?.mescladaEm).toBe("comanda-A");
    expect(porId.get("comanda-C")?.mescladaEm).toBe("comanda-A"); // mescla direto na canônica, não em B
  });
});

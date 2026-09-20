import { describe, expect, it } from "vitest";
import type { Evento } from "@passa-a-regua/shared-types";
import { serialize, tick, ZERO } from "../src/hlc.js";
import { projetar, sortEventos } from "../src/reconciliation.js";

let contador = 0;
function novoHlc(wall: number) {
  return serialize(tick(ZERO, wall + contador++));
}

describe("projeção — demais tipos de evento", () => {
  it("operador_cadastrado materializa em `operadores`", () => {
    const evento: Evento = {
      id: "ev-1",
      hlc: novoHlc(1000),
      aggregateType: "operador",
      aggregateId: "op-1",
      tipo: "operador_cadastrado",
      terminalId: "T1",
      operadorId: "op-1",
      criadoEm: 1000,
      payload: { nome: "Ana", papel: "garcom", pinHash: "hash-123" },
    };
    const estado = projetar(sortEventos([evento]));
    expect(estado.operadores).toEqual([{ id: "op-1", nome: "Ana", papel: "garcom", pinHash: "hash-123" }]);
  });

  it("comanda_transferida muda a mesa atual e preserva itens/histórico (PRD 2.5)", () => {
    const abrir: Evento = {
      id: "ev-1",
      hlc: novoHlc(1000),
      aggregateType: "comanda",
      aggregateId: "c-1",
      tipo: "comanda_aberta",
      terminalId: "T1",
      operadorId: "op-1",
      criadoEm: 1000,
      payload: { origem: "mesa", mesaId: "mesa-1" },
    };
    const item: Evento = {
      id: "ev-2",
      hlc: novoHlc(1000),
      aggregateType: "comanda",
      aggregateId: "c-1",
      tipo: "item_adicionado",
      terminalId: "T1",
      operadorId: "op-1",
      criadoEm: 1000,
      payload: { itemId: "i-1", nome: "Cerveja", precoUnitarioCentavos: 1000, quantidade: 1 },
    };
    const transferencia: Evento = {
      id: "ev-3",
      hlc: novoHlc(1000),
      aggregateType: "comanda",
      aggregateId: "c-1",
      tipo: "comanda_transferida",
      terminalId: "T1",
      operadorId: "op-1",
      criadoEm: 1000,
      payload: { mesaOrigemId: "mesa-1", mesaDestinoId: "mesa-2" },
    };

    const estado = projetar(sortEventos([abrir, item, transferencia]));
    const comanda = estado.comandas.find((c) => c.id === "c-1")!;
    expect(comanda.mesaAtualId).toBe("mesa-2");
    expect(comanda.itens).toHaveLength(1);
    expect(comanda.transferencias).toEqual([{ mesaOrigemId: "mesa-1", mesaDestinoId: "mesa-2", hlc: transferencia.hlc }]);

    // A mesa de origem fica livre pra uma nova comanda, sem conflito (PRD 2.5).
    const novaAbertura: Evento = {
      id: "ev-4",
      hlc: novoHlc(1000),
      aggregateType: "comanda",
      aggregateId: "c-2",
      tipo: "comanda_aberta",
      terminalId: "T1",
      operadorId: "op-1",
      criadoEm: 1000,
      payload: { origem: "mesa", mesaId: "mesa-1" },
    };
    const estado2 = projetar(sortEventos([abrir, item, transferencia, novaAbertura]));
    expect(estado2.comandas.find((c) => c.id === "c-2")?.mescladaEm).toBeUndefined();
  });

  it("mesas_agrupadas materializa em `gruposDeMesas` sem mesclar dados de comanda (PRD 2.6)", () => {
    const evento: Evento = {
      id: "ev-1",
      hlc: novoHlc(1000),
      aggregateType: "grupo_mesas",
      aggregateId: "g-1",
      tipo: "mesas_agrupadas",
      terminalId: "T1",
      operadorId: "op-1",
      criadoEm: 1000,
      payload: { mesaIds: ["mesa-1", "mesa-2"] },
    };
    const estado = projetar(sortEventos([evento]));
    expect(estado.gruposDeMesas).toEqual([{ id: "g-1", mesaIds: ["mesa-1", "mesa-2"] }]);
  });

  it("comanda_fechada marca status e guarda o resumo; pagamento_registrado acumula os splits (PRD 5.1-5.5)", () => {
    const abrir: Evento = {
      id: "ev-1",
      hlc: novoHlc(1000),
      aggregateType: "comanda",
      aggregateId: "c-1",
      tipo: "comanda_aberta",
      terminalId: "T1",
      operadorId: "op-1",
      criadoEm: 1000,
      payload: { origem: "avulsa", numero: 1 },
    };
    const pagamento1: Evento = {
      id: "ev-2",
      hlc: novoHlc(1000),
      aggregateType: "comanda",
      aggregateId: "c-1",
      tipo: "pagamento_registrado",
      terminalId: "T1",
      operadorId: "op-1",
      criadoEm: 1000,
      payload: { valorCentavos: 2000, formaPagamento: "dinheiro", trocoCentavos: 500 },
    };
    const pagamento2: Evento = {
      id: "ev-3",
      hlc: novoHlc(1000),
      aggregateType: "comanda",
      aggregateId: "c-1",
      tipo: "pagamento_registrado",
      terminalId: "T1",
      operadorId: "op-1",
      criadoEm: 1000,
      payload: { valorCentavos: 1500, formaPagamento: "cartao", trocoCentavos: 0 },
    };
    const fechamento: Evento = {
      id: "ev-4",
      hlc: novoHlc(1000),
      aggregateType: "comanda",
      aggregateId: "c-1",
      tipo: "comanda_fechada",
      terminalId: "T1",
      operadorId: "op-1",
      criadoEm: 1000,
      payload: { subtotalCentavos: 3000, taxaServicoPercentual: 10, taxaServicoCentavos: 300, totalCentavos: 3300 },
    };

    const estado = projetar(sortEventos([abrir, pagamento1, pagamento2, fechamento]));
    const comanda = estado.comandas.find((c) => c.id === "c-1")!;
    expect(comanda.status).toBe("fechada");
    expect(comanda.fechamento).toEqual({
      subtotalCentavos: 3000,
      taxaServicoPercentual: 10,
      taxaServicoCentavos: 300,
      totalCentavos: 3300,
    });
    expect(comanda.pagamentos).toEqual([
      { valorCentavos: 2000, formaPagamento: "dinheiro", trocoCentavos: 500 },
      { valorCentavos: 1500, formaPagamento: "cartao", trocoCentavos: 0 },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import type { Evento } from "@passa-a-regua/shared-types";
import { abrirBanco, buscarEventosPorAggregateId, inserirEvento, inserirEventos, listarEventosDesdeCursor } from "../src/db.js";
import { serialize, tick, ZERO } from "../src/hlc.js";

function evento(id: string, wall: number, aggregateId = "c-1"): Evento {
  return {
    id,
    hlc: serialize(tick(ZERO, wall)),
    aggregateType: "comanda",
    aggregateId,
    tipo: "item_adicionado",
    terminalId: "T1",
    operadorId: "op-1",
    criadoEm: wall,
    payload: { itemId: `item-${id}`, nome: "Item", precoUnitarioCentavos: 100, quantidade: 1 },
  };
}

describe("db — persistência SQLite (node:sqlite, ARCH §3.1)", () => {
  it("insere e lista eventos em ordem de HLC", () => {
    const db = abrirBanco(":memory:");
    inserirEvento(db, evento("ev-2", 2000));
    inserirEvento(db, evento("ev-1", 1000));
    inserirEvento(db, evento("ev-3", 3000));

    const eventos = listarEventosDesdeCursor(db);
    expect(eventos.map((e) => e.id)).toEqual(["ev-1", "ev-2", "ev-3"]);
    // Roundtrip fiel: payload, tipos e campos batem com o que foi inserido.
    expect(eventos[0]).toEqual(evento("ev-1", 1000));
  });

  it("é idempotente por id (ARCH §4.3) — reinserir o mesmo evento não duplica", () => {
    const db = abrirBanco(":memory:");
    const e = evento("ev-1", 1000);
    inserirEvento(db, e);
    inserirEvento(db, e);
    inserirEvento(db, e);
    expect(listarEventosDesdeCursor(db)).toHaveLength(1);
  });

  it("listarEventosDesdeCursor(hlc) só retorna o que vem depois do cursor (sync incremental)", () => {
    const db = abrirBanco(":memory:");
    const e1 = evento("ev-1", 1000);
    const e2 = evento("ev-2", 2000);
    const e3 = evento("ev-3", 3000);
    inserirEventos(db, [e1, e2, e3]);

    const desdeE1 = listarEventosDesdeCursor(db, e1.hlc);
    expect(desdeE1.map((e) => e.id)).toEqual(["ev-2", "ev-3"]);
  });

  it("buscarEventosPorAggregateId filtra por comanda e mantém ordem de HLC", () => {
    const db = abrirBanco(":memory:");
    inserirEventos(db, [evento("ev-1", 1000, "c-1"), evento("ev-2", 1500, "c-2"), evento("ev-3", 2000, "c-1")]);

    const doC1 = buscarEventosPorAggregateId(db, "c-1");
    expect(doC1.map((e) => e.id)).toEqual(["ev-1", "ev-3"]);
  });

  it("inserirEventos com um id já existente no meio do lote não impede os outros de entrarem (INSERT OR IGNORE)", () => {
    // Cenário real: reaplicar um lote de sync onde parte já tinha sido
    // inserida antes (conexão caiu no meio) — precisa completar o resto,
    // não abortar tudo por causa da duplicata (ARCH §4.3).
    const db = abrirBanco(":memory:");
    const jaExistente = evento("ev-1", 1000);
    inserirEvento(db, jaExistente);

    inserirEventos(db, [jaExistente, evento("ev-2", 2000), evento("ev-3", 3000)]);

    expect(listarEventosDesdeCursor(db).map((e) => e.id)).toEqual(["ev-1", "ev-2", "ev-3"]);
  });
});

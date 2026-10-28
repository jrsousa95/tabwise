import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@tabwise/shared-types";
import { openDatabase, findEventsByAggregateId, insertEvent, insertEvents, listEventsSinceCursor } from "../src/db.js";
import { serialize, tick, ZERO } from "../src/hlc.js";

function event(id: string, wall: number, aggregateId = "c-1"): DomainEvent {
  return {
    id,
    hlc: serialize(tick(ZERO, wall)),
    aggregateType: "order",
    aggregateId,
    type: "item_added",
    terminalId: "T1",
    operatorId: "op-1",
    createdAt: wall,
    payload: { itemId: `item-${id}`, name: "Item", unitPriceCents: 100, quantity: 1 },
  };
}

describe("db — persistência SQLite (node:sqlite, ARCH §3.1)", () => {
  it("insere e lista eventos em ordem de HLC", () => {
    const db = openDatabase(":memory:");
    insertEvent(db, event("ev-2", 2000));
    insertEvent(db, event("ev-1", 1000));
    insertEvent(db, event("ev-3", 3000));

    const events = listEventsSinceCursor(db);
    expect(events.map((e) => e.id)).toEqual(["ev-1", "ev-2", "ev-3"]);
    // Roundtrip fiel: payload, tipos e campos batem com o que foi inserido.
    expect(events[0]).toEqual(event("ev-1", 1000));
  });

  it("é idempotente por id (ARCH §4.3) — reinserir o mesmo evento não duplica", () => {
    const db = openDatabase(":memory:");
    const e = event("ev-1", 1000);
    insertEvent(db, e);
    insertEvent(db, e);
    insertEvent(db, e);
    expect(listEventsSinceCursor(db)).toHaveLength(1);
  });

  it("listEventsSinceCursor(hlc) só retorna o que vem depois do cursor (sync incremental)", () => {
    const db = openDatabase(":memory:");
    const e1 = event("ev-1", 1000);
    const e2 = event("ev-2", 2000);
    const e3 = event("ev-3", 3000);
    insertEvents(db, [e1, e2, e3]);

    const sinceE1 = listEventsSinceCursor(db, e1.hlc);
    expect(sinceE1.map((e) => e.id)).toEqual(["ev-2", "ev-3"]);
  });

  it("findEventsByAggregateId filtra por order e mantém ordem de HLC", () => {
    const db = openDatabase(":memory:");
    insertEvents(db, [event("ev-1", 1000, "c-1"), event("ev-2", 1500, "c-2"), event("ev-3", 2000, "c-1")]);

    const fromC1 = findEventsByAggregateId(db, "c-1");
    expect(fromC1.map((e) => e.id)).toEqual(["ev-1", "ev-3"]);
  });

  it("insertEvents com um id já existente no meio do lote não impede os outros de entrarem (INSERT OR IGNORE)", () => {
    // Cenário real: reaplicar um lote de sync onde parte já tinha sido
    // inserida antes (conexão caiu no meio) — precisa completar o resto,
    // não abortar tudo por causa da duplicata (ARCH §4.3).
    const db = openDatabase(":memory:");
    const alreadyExisting = event("ev-1", 1000);
    insertEvent(db, alreadyExisting);

    insertEvents(db, [alreadyExisting, event("ev-2", 2000), event("ev-3", 3000)]);

    expect(listEventsSinceCursor(db).map((e) => e.id)).toEqual(["ev-1", "ev-2", "ev-3"]);
  });
});

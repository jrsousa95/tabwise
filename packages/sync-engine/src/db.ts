import { DatabaseSync } from "node:sqlite";
import { DomainEventSchema, type DomainEvent } from "@tabwise/shared-types";

/**
 * Schema da tabela `events` — append-only, fonte de verdade (ARCH §3.1).
 * Usa `node:sqlite` (embutido no Node desde a v22, estável na v24 já usada
 * no projeto) em vez de um binding nativo como `better-sqlite3` — mantém a
 * história do Spike 1 (binário SEA standalone, sem dependência nativa
 * compilada por plataforma).
 */
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY NOT NULL,
    hlc TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    operator_id TEXT NOT NULL,
    terminal_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_hlc ON events (hlc);
  CREATE INDEX IF NOT EXISTS idx_events_aggregate_id ON events (aggregate_id);
`;

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA_SQL);
  return db;
}

interface EventRow {
  readonly id: string;
  readonly hlc: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly type: string;
  readonly payload: string;
  readonly operator_id: string;
  readonly terminal_id: string;
  readonly created_at: number;
}

function rowToEvent(row: EventRow): DomainEvent {
  // Revalida com o Zod ao ler — protege contra dado corrompido/de uma
  // versão antiga do schema, não só na escrita.
  return DomainEventSchema.parse({
    id: row.id,
    hlc: row.hlc,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    type: row.type,
    payload: JSON.parse(row.payload),
    operatorId: row.operator_id,
    terminalId: row.terminal_id,
    createdAt: row.created_at,
  });
}

const SQL_INSERT = `
  INSERT OR IGNORE INTO events
    (id, hlc, aggregate_type, aggregate_id, type, payload, operator_id, terminal_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/** Idempotente por `id` (ARCH §4.3) — reaplicar o mesmo evento é seguro e não duplica. */
export function insertEvent(db: DatabaseSync, event: DomainEvent): void {
  db.prepare(SQL_INSERT).run(
    event.id,
    event.hlc,
    event.aggregateType,
    event.aggregateId,
    event.type,
    JSON.stringify(event.payload),
    event.operatorId,
    event.terminalId,
    event.createdAt
  );
}

/** Insere vários eventos numa única transação (uso típico: aplicar um lote recebido de outro terminal). */
export function insertEvents(db: DatabaseSync, events: readonly DomainEvent[]): void {
  db.exec("BEGIN");
  try {
    for (const event of events) insertEvent(db, event);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Lista eventos em ordem de HLC, prontos pra `project()`. Com `cursorHlc`,
 * retorna só o que vem depois — é a base do sync incremental do M9 ("me dá
 * tudo que você tem desde X").
 */
export function listEventsSinceCursor(db: DatabaseSync, cursorHlc?: string): DomainEvent[] {
  const rows = (
    cursorHlc === undefined
      ? db.prepare("SELECT * FROM events ORDER BY hlc ASC, id ASC").all()
      : db.prepare("SELECT * FROM events WHERE hlc > ? ORDER BY hlc ASC, id ASC").all(cursorHlc)
  ) as unknown as EventRow[];
  return rows.map(rowToEvent);
}

export function findEventsByAggregateId(db: DatabaseSync, aggregateId: string): DomainEvent[] {
  const rows = db
    .prepare("SELECT * FROM events WHERE aggregate_id = ? ORDER BY hlc ASC, id ASC")
    .all(aggregateId) as unknown as EventRow[];
  return rows.map(rowToEvent);
}

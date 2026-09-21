import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { DomainEventSchema, type DomainEvent } from "@passa-a-regua/shared-types";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type Db = pg.Pool;

export async function openDatabase(connectionString: string): Promise<Db> {
  const pool = new Pool({ connectionString });
  const schema = readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
  return pool;
}

export async function createEstablishment(db: Db, name: string): Promise<{ id: string }> {
  const result = await db.query<{ id: string }>("INSERT INTO establishments (name) VALUES ($1) RETURNING id", [name]);
  return { id: result.rows[0]!.id };
}

export async function registerTerminal(db: Db, terminalId: string, establishmentId: string, credentialHash: string): Promise<void> {
  await db.query("INSERT INTO terminals (id, establishment_id, credential_hash) VALUES ($1, $2, $3)", [
    terminalId,
    establishmentId,
    credentialHash,
  ]);
}

export interface TerminalRow {
  readonly id: string;
  readonly establishmentId: string;
  readonly credentialHash: string;
}

export async function findTerminal(db: Db, terminalId: string): Promise<TerminalRow | null> {
  const result = await db.query<{ id: string; establishment_id: string; credential_hash: string }>(
    "SELECT id, establishment_id, credential_hash FROM terminals WHERE id = $1",
    [terminalId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, establishmentId: row.establishment_id, credentialHash: row.credential_hash };
}

export async function touchTerminal(db: Db, terminalId: string): Promise<void> {
  await db.query("UPDATE terminals SET last_seen_at = now() WHERE id = $1", [terminalId]);
}

/** PRD 8.1 — usado no pareamento (`POST /terminals`) pra bloquear um 2º terminal no plano free. */
export async function countTerminals(db: Db, establishmentId: string): Promise<number> {
  const result = await db.query<{ count: string }>("SELECT count(*) FROM terminals WHERE establishment_id = $1", [establishmentId]);
  return Number(result.rows[0]!.count);
}

export interface EstablishmentPlan {
  readonly maxConcurrentOrders: number;
  readonly maxTerminals: number;
}

/**
 * M10 (ARCH §6, PRD 8.3) — o backend é a fonte de verdade dos limites de
 * plano. Guardados como colunas em `establishments` (já existem desde o
 * M9, com os defaults do plano free) em vez de uma tabela `plans`
 * separada — não há mais de um estabelecimento por "assinatura" nem
 * cobrança/tiers nomeados no MVP, só o valor efetivo por estabelecimento;
 * uma tabela de planos separada seria estrutura sem consumidor.
 * Configurável sem novo deploy: é um `UPDATE` direto no Postgres.
 */
export async function getEstablishmentPlan(db: Db, establishmentId: string): Promise<EstablishmentPlan | null> {
  const result = await db.query<{ max_concurrent_orders: number; max_terminals: number }>(
    "SELECT max_concurrent_orders, max_terminals FROM establishments WHERE id = $1",
    [establishmentId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { maxConcurrentOrders: row.max_concurrent_orders, maxTerminals: row.max_terminals };
}

/** Idempotente por `id` (ARCH §4.3) — mesmo princípio do `insertEvent` local em `packages/sync-engine/src/db.ts`. */
export async function insertEvents(db: Db, establishmentId: string, events: readonly DomainEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  let inserted = 0;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const event of events) {
      const result = await client.query(
        `INSERT INTO events (id, establishment_id, hlc, aggregate_type, aggregate_id, type, payload, operator_id, terminal_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          event.id,
          establishmentId,
          event.hlc,
          event.aggregateType,
          event.aggregateId,
          event.type,
          JSON.stringify(event.payload),
          event.operatorId,
          event.terminalId,
          event.createdAt,
        ]
      );
      inserted += result.rowCount ?? 0;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return inserted;
}

export async function listEventsSince(db: Db, establishmentId: string, cursorHlc?: string): Promise<DomainEvent[]> {
  const result = await db.query<{
    id: string;
    hlc: string;
    aggregate_type: string;
    aggregate_id: string;
    type: string;
    payload: unknown;
    operator_id: string;
    terminal_id: string;
    created_at: string;
  }>(
    cursorHlc === undefined
      ? "SELECT * FROM events WHERE establishment_id = $1 ORDER BY hlc ASC, id ASC"
      : "SELECT * FROM events WHERE establishment_id = $1 AND hlc > $2 ORDER BY hlc ASC, id ASC",
    cursorHlc === undefined ? [establishmentId] : [establishmentId, cursorHlc]
  );
  // Revalida com o Zod ao ler — mesmo princípio do `rowToEvent` local em
  // packages/sync-engine/src/db.ts, protege contra dado corrompido.
  return result.rows.map((row) =>
    DomainEventSchema.parse({
      id: row.id,
      hlc: row.hlc,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      type: row.type,
      payload: row.payload,
      operatorId: row.operator_id,
      terminalId: row.terminal_id,
      createdAt: Number(row.created_at),
    })
  );
}

export async function upsertProjection(db: Db, establishmentId: string, state: unknown): Promise<void> {
  await db.query(
    `INSERT INTO projections (establishment_id, state, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (establishment_id) DO UPDATE SET state = $2, updated_at = now()`,
    [establishmentId, JSON.stringify(state)]
  );
}

export async function getProjection(db: Db, establishmentId: string): Promise<unknown | null> {
  const result = await db.query<{ state: unknown }>("SELECT state FROM projections WHERE establishment_id = $1", [establishmentId]);
  return result.rows[0]?.state ?? null;
}

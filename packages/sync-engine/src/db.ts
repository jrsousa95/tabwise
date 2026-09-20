import { DatabaseSync } from "node:sqlite";
import { EventoSchema, type Evento } from "@passa-a-regua/shared-types";

/**
 * Schema da tabela `eventos` — append-only, fonte de verdade (ARCH §3.1).
 * Usa `node:sqlite` (embutido no Node desde a v22, estável na v24 já usada
 * no projeto) em vez de um binding nativo como `better-sqlite3` — mantém a
 * história do Spike 1 (binário SEA standalone, sem dependência nativa
 * compilada por plataforma).
 */
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS eventos (
    id TEXT PRIMARY KEY NOT NULL,
    hlc TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    tipo TEXT NOT NULL,
    payload TEXT NOT NULL,
    operador_id TEXT NOT NULL,
    terminal_id TEXT NOT NULL,
    criado_em INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_eventos_hlc ON eventos (hlc);
  CREATE INDEX IF NOT EXISTS idx_eventos_aggregate_id ON eventos (aggregate_id);
`;

export function abrirBanco(caminho: string): DatabaseSync {
  const db = new DatabaseSync(caminho);
  db.exec(SCHEMA_SQL);
  return db;
}

interface LinhaEvento {
  readonly id: string;
  readonly hlc: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly tipo: string;
  readonly payload: string;
  readonly operador_id: string;
  readonly terminal_id: string;
  readonly criado_em: number;
}

function linhaParaEvento(linha: LinhaEvento): Evento {
  // Revalida com o Zod ao ler — protege contra dado corrompido/de uma
  // versão antiga do schema, não só na escrita.
  return EventoSchema.parse({
    id: linha.id,
    hlc: linha.hlc,
    aggregateType: linha.aggregate_type,
    aggregateId: linha.aggregate_id,
    tipo: linha.tipo,
    payload: JSON.parse(linha.payload),
    operadorId: linha.operador_id,
    terminalId: linha.terminal_id,
    criadoEm: linha.criado_em,
  });
}

const SQL_INSERT = `
  INSERT OR IGNORE INTO eventos
    (id, hlc, aggregate_type, aggregate_id, tipo, payload, operador_id, terminal_id, criado_em)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/** Idempotente por `id` (ARCH §4.3) — reaplicar o mesmo evento é seguro e não duplica. */
export function inserirEvento(db: DatabaseSync, evento: Evento): void {
  db.prepare(SQL_INSERT).run(
    evento.id,
    evento.hlc,
    evento.aggregateType,
    evento.aggregateId,
    evento.tipo,
    JSON.stringify(evento.payload),
    evento.operadorId,
    evento.terminalId,
    evento.criadoEm
  );
}

/** Insere vários eventos numa única transação (uso típico: aplicar um lote recebido de outro terminal). */
export function inserirEventos(db: DatabaseSync, eventos: readonly Evento[]): void {
  db.exec("BEGIN");
  try {
    for (const evento of eventos) inserirEvento(db, evento);
    db.exec("COMMIT");
  } catch (erro) {
    db.exec("ROLLBACK");
    throw erro;
  }
}

/**
 * Lista eventos em ordem de HLC, prontos pra `projetar()`. Com `cursorHlc`,
 * retorna só o que vem depois — é a base do sync incremental do M9 ("me dá
 * tudo que você tem desde X").
 */
export function listarEventosDesdeCursor(db: DatabaseSync, cursorHlc?: string): Evento[] {
  const linhas = (
    cursorHlc === undefined
      ? db.prepare("SELECT * FROM eventos ORDER BY hlc ASC, id ASC").all()
      : db.prepare("SELECT * FROM eventos WHERE hlc > ? ORDER BY hlc ASC, id ASC").all(cursorHlc)
  ) as unknown as LinhaEvento[];
  return linhas.map(linhaParaEvento);
}

export function buscarEventosPorAggregateId(db: DatabaseSync, aggregateId: string): Evento[] {
  const linhas = db
    .prepare("SELECT * FROM eventos WHERE aggregate_id = ? ORDER BY hlc ASC, id ASC")
    .all(aggregateId) as unknown as LinhaEvento[];
  return linhas.map(linhaParaEvento);
}

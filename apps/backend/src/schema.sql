-- M9 (ARCH §5, §8) — schema do backend de sync. Aplicado via CREATE TABLE
-- IF NOT EXISTS no boot (mesma decisão de simplicidade do SQLite local em
-- packages/sync-engine/src/db.ts — sem framework de migration ainda, MVP).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS establishments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  -- PRD Épico 8/ARCH §6 — limites do plano free, fonte de verdade daqui.
  max_concurrent_orders INTEGER NOT NULL DEFAULT 10,
  max_terminals INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS terminals (
  -- Mesmo id que o terminal já usa localmente (terminal-identity.ts) — não
  -- um id novo gerado aqui, pra bater com o `terminal_id` que já vem em
  -- todo evento sincronizado.
  id TEXT PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES establishments(id),
  -- Nunca a credencial em texto plano (ARCH §7) — mesmo hashing de PIN.
  credential_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES establishments(id),
  hlc TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  operator_id TEXT NOT NULL,
  terminal_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_establishment_hlc ON events (establishment_id, hlc);

-- Projeção materializada (ARCH §5): em vez de mapear o resultado de
-- `project()` do sync-engine pra um schema relacional próprio (esforço
-- grande, sem necessidade ainda — o único consumidor até o M11 é o
-- endpoint de relatório read-only), guarda o estado projetado inteiro como
-- JSONB, recalculado a cada lote de eventos ingerido. Reavaliar se/quando
-- performance ou consultas mais ricas exigirem tabelas normalizadas de
-- verdade.
CREATE TABLE IF NOT EXISTS projections (
  establishment_id UUID PRIMARY KEY REFERENCES establishments(id),
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

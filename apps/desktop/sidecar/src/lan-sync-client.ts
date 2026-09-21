import type { DatabaseSync } from "node:sqlite";
import { DomainEventSchema } from "@passa-a-regua/shared-types";
import { insertEvent, listEventsSinceCursor } from "@passa-a-regua/sync-engine";
import { receiveHlc } from "./clock.js";
import { loadOrCreateLanToken } from "./lan-pairing.js";
import { listLanSyncTargets } from "./sync-targets.js";

const SYNC_INTERVAL_MS = 5000;
const REQUEST_TIMEOUT_MS = 5000;

type SyncResult = { ok: true; pushed: number; pulled: number } | { ok: false; error: string };

/**
 * M9 (ARCH §1) — LAN sync e cloud sync usam o mesmo protocolo (troca de
 * logs de eventos), só o transporte muda. Aqui: push de tudo que este
 * terminal tem + pull de tudo que o peer tem, num único round-trip.
 *
 * Sem cursor incremental de propósito — reenviar/reler tudo a cada ciclo é
 * seguro (idempotente por id) e simples; volume de eventos de um bar num
 * dia é pequeno o suficiente pra isso não ser um problema real no MVP.
 */
export async function syncWithPeer(db: DatabaseSync, target: { host: string; port: number }, lanToken: string): Promise<SyncResult> {
  const base = `http://${target.host}:${target.port}`;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${lanToken}` };
  const signal = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  try {
    const localEvents = listEventsSinceCursor(db);
    const pushRes = await fetch(`${base}/sync/events`, {
      method: "POST",
      headers,
      body: JSON.stringify({ events: localEvents }),
      signal: signal(),
    });
    if (!pushRes.ok) return { ok: false, error: `push falhou: HTTP ${pushRes.status}` };

    const pullRes = await fetch(`${base}/sync/events`, { headers, signal: signal() });
    if (!pullRes.ok) return { ok: false, error: `pull falhou: HTTP ${pullRes.status}` };
    const remoteEventsRaw = (await pullRes.json()) as unknown[];

    let pulled = 0;
    for (const raw of remoteEventsRaw) {
      const event = DomainEventSchema.parse(raw);
      insertEvent(db, event);
      receiveHlc(event.hlc);
      pulled++;
    }

    return { ok: true, pushed: localEvents.length, pulled };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * ARCH §2, decisão 3 — tenta o host configurado manualmente primeiro (se
 * houver), depois qualquer peer descoberto por mDNS, na ordem em que foram
 * vistos. Para no primeiro sucesso: não precisa sincronizar com todo mundo
 * no mesmo ciclo, a malha converge ao longo de vários ciclos.
 */
async function runOneSyncCycle(db: DatabaseSync, dataDir: string): Promise<void> {
  // Lido do disco a cada ciclo (em vez de capturado uma vez no boot) porque
  // o token pode mudar em runtime via `POST /pairing/lan-token` (adoção de
  // um token de outro terminal).
  const lanToken = loadOrCreateLanToken(dataDir);
  const targets = listLanSyncTargets(dataDir);

  for (const target of targets) {
    const result = await syncWithPeer(db, target, lanToken);
    if (result.ok) return;
  }
}

export function startLanSyncLoop(db: DatabaseSync, dataDir: string): () => void {
  const interval = setInterval(() => {
    runOneSyncCycle(db, dataDir).catch(() => {
      // Falha de sync não deve derrubar o sidecar — só tenta de novo no próximo ciclo.
    });
  }, SYNC_INTERVAL_MS);
  return () => clearInterval(interval);
}

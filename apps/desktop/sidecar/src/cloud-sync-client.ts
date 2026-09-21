import type { DatabaseSync } from "node:sqlite";
import { DomainEventSchema } from "@passa-a-regua/shared-types";
import { insertEvent, listEventsSinceCursor } from "@passa-a-regua/sync-engine";
import { loadOrCreateLanToken } from "./lan-pairing.js";
import { receiveHlc } from "./clock.js";
import { loadCloudCredential, saveCloudCredential, type CloudCredential } from "./cloud-credential.js";
import { listLanSyncTargets } from "./sync-targets.js";

const SYNC_INTERVAL_MS = 5000;
const REQUEST_TIMEOUT_MS = 8000;

// Override só pra apontar pro backend certo (dev local vs. produção, quando existir).
export const BACKEND_URL = process.env.PASSA_A_REGUA_BACKEND_URL ?? "http://localhost:4551";

/**
 * M9 (ARCH §7) — pergunta a cada peer LAN pareado (mesmo token) se ELE já
 * tem credencial de nuvem; se tiver, ele patrocina o cadastro deste
 * terminal no MESMO estabelecimento (`POST /sync/sponsor-cloud-registration`
 * no peer → `POST /terminals` no backend). Achado durante o teste do M9:
 * sem isso, dois terminais pareados na LAN viravam dois estabelecimentos
 * separados na nuvem, cada um autocadastrado de forma independente.
 */
async function trySponsoredRegistration(dataDir: string, terminalId: string): Promise<CloudCredential | null> {
  const lanToken = loadOrCreateLanToken(dataDir);
  for (const target of listLanSyncTargets(dataDir)) {
    try {
      const res = await fetch(`http://${target.host}:${target.port}/sync/sponsor-cloud-registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${lanToken}` },
        body: JSON.stringify({ terminalId }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      return (await res.json()) as CloudCredential;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * M9 (ARCH §5, decisão validada com o usuário) — sem login web de dono no
 * MVP: primeiro tenta ser patrocinado por um peer LAN já registrado (mesmo
 * estabelecimento); só se nenhum peer puder patrocinar, este terminal vira
 * o "âncora" e se autocadastra como um estabelecimento novo. Credencial
 * resultante fica persistida em disco; próximos ciclos e boots reaproveitam.
 */
async function ensureCredential(dataDir: string, terminalId: string): Promise<CloudCredential | null> {
  const existing = loadCloudCredential(dataDir);
  if (existing) return existing;

  const targets = listLanSyncTargets(dataDir);
  const sponsored = await trySponsoredRegistration(dataDir, terminalId);
  if (sponsored) {
    saveCloudCredential(dataDir, sponsored);
    return sponsored;
  }

  // Tem peer pareado configurado mas nenhum conseguiu patrocinar ainda
  // (provavelmente também sem credencial, ex: os dois terminais subiram
  // juntos). Espera aleatória antes de virar âncora — sem isso, os dois
  // cairiam no autocadastro no MESMO ciclo e virariam dois estabelecimentos
  // separados de novo (mesma colisão que o patrocínio resolve, só que
  // simultânea). Detona a simetria em poucos ciclos.
  if (targets.length > 0 && Math.random() > 0.2) return null;

  try {
    const res = await fetch(`${BACKEND_URL}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terminalId }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const credential = (await res.json()) as CloudCredential;
    saveCloudCredential(dataDir, credential);
    return credential;
  } catch {
    return null;
  }
}

async function runOneSyncCycle(db: DatabaseSync, dataDir: string, terminalId: string): Promise<void> {
  const credential = await ensureCredential(dataDir, terminalId);
  if (!credential) return; // nuvem inalcançável ou registro falhou — tenta de novo no próximo ciclo

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${credential.credential}` };
  const signal = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  const localEvents = listEventsSinceCursor(db);
  const pushRes = await fetch(`${BACKEND_URL}/sync/push`, {
    method: "POST",
    headers,
    body: JSON.stringify({ events: localEvents }),
    signal: signal(),
  });
  if (!pushRes.ok) return;

  const pullRes = await fetch(`${BACKEND_URL}/sync/pull`, { headers, signal: signal() });
  if (!pullRes.ok) return;
  const remoteEventsRaw = (await pullRes.json()) as unknown[];

  for (const raw of remoteEventsRaw) {
    const event = DomainEventSchema.parse(raw);
    insertEvent(db, event);
    receiveHlc(event.hlc);
  }
}

/** Independente do sync LAN (ARCH §5) — roda no seu próprio ciclo, uma queda da nuvem não afeta o sync entre terminais. */
export function startCloudSyncLoop(db: DatabaseSync, dataDir: string, terminalId: string): () => void {
  const interval = setInterval(() => {
    runOneSyncCycle(db, dataDir, terminalId).catch(() => {
      // Nuvem fora do ar não pode travar o terminal — só tenta de novo no próximo ciclo.
    });
  }, SYNC_INTERVAL_MS);
  return () => clearInterval(interval);
}

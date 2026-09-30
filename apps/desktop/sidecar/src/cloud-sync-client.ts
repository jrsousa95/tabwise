import type { DatabaseSync } from "node:sqlite";
import { DomainEventSchema } from "@passa-a-regua/shared-types";
import { insertEvent, listEventsSinceCursor, project, sortEvents } from "@passa-a-regua/sync-engine";
import { loadOrCreateLanToken } from "./lan-pairing.js";
import { receiveHlc } from "./clock.js";
import { loadCloudCredential, saveCloudCredential, type CloudCredential } from "./cloud-credential.js";
import { listLanSyncTargets } from "./sync-targets.js";
import { savePlanCache, type PlanLimits } from "./plan-cache.js";
import { saveRegistrationError, clearRegistrationError } from "./registration-status.js";

const SYNC_INTERVAL_MS = 5000;
// Achado no code review, 2026-09-30 (blind-hunter): exportado pra
// `routes/reports.ts` (Story 3.1) reaproveitar em vez de duplicar o mesmo
// valor numa constante própria, que podia divergir silenciosamente.
export const REQUEST_TIMEOUT_MS = 8000;

// Override só pra apontar pro backend certo (dev local vs. produção, quando existir).
export const BACKEND_URL = process.env.PASSA_A_REGUA_BACKEND_URL ?? "http://localhost:4551";

/**
 * M12 (ARCH §7, revisão de segurança) — "HTTPS obrigatório" pro sync com a
 * nuvem é uma decisão de arquitetura, não algo que o código consiga
 * impor sozinho (o backend real pode ficar atrás de um proxy/load
 * balancer que termina TLS, por exemplo). Isso aqui só evita o erro mais
 * comum: apontar `PASSA_A_REGUA_BACKEND_URL` pra um endereço `http://`
 * que não seja loopback/dev local, o que mandaria a credencial de
 * terminal em texto plano pela rede.
 */
function warnIfInsecureBackendUrl(url: string): void {
  if (url.startsWith("https://")) return;
  const isLocalDev = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(url);
  if (isLocalDev) return;
  console.warn(
    `[sidecar] ATENÇÃO: PASSA_A_REGUA_BACKEND_URL (${url}) não usa HTTPS — a credencial de terminal trafegaria em texto plano pela rede (ARCH §7). Use https:// em qualquer ambiente que não seja dev local.`
  );
}
warnIfInsecureBackendUrl(BACKEND_URL);

/**
 * M9 (ARCH §7) — pergunta a cada peer LAN pareado (mesmo token) se ELE já
 * tem credencial de nuvem; se tiver, ele patrocina o cadastro deste
 * terminal no MESMO estabelecimento (`POST /sync/sponsor-cloud-registration`
 * no peer → `POST /terminals` no backend). Achado durante o teste do M9:
 * sem isso, dois terminais pareados na LAN viravam dois estabelecimentos
 * separados na nuvem, cada um autocadastrado de forma independente.
 */
type SponsorResult =
  | { status: "sponsored"; credential: CloudCredential }
  | { status: "blocked"; message: string }
  | { status: "unavailable" };

/**
 * M10 (PRD 8.1) — o backend pode recusar em definitivo (403, limite de
 * terminais do plano atingido) em vez de só "peer não alcançável". Esses
 * dois casos precisam de tratamento diferente: um 403 não deve fazer este
 * terminal cair pro autocadastro como estabelecimento novo (isso seria só
 * um jeito de burlar o limite recriando o problema que o patrocínio do M9
 * já resolveu) — precisa ficar bloqueado e mostrar uma mensagem clara.
 */
async function trySponsoredRegistration(dataDir: string, terminalId: string): Promise<SponsorResult> {
  const lanToken = loadOrCreateLanToken(dataDir);
  for (const target of listLanSyncTargets(dataDir)) {
    try {
      const res = await fetch(`http://${target.host}:${target.port}/sync/sponsor-cloud-registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${lanToken}` },
        body: JSON.stringify({ terminalId }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) return { status: "sponsored", credential: body as CloudCredential };
      if (res.status === 403) {
        return { status: "blocked", message: (body as { error?: string } | null)?.error ?? "limite do plano atingido" };
      }
      // Outro erro (peer ainda sem credencial própria, 409, etc.) — tenta o próximo alvo.
    } catch {
      continue;
    }
  }
  return { status: "unavailable" };
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
  const sponsorResult = await trySponsoredRegistration(dataDir, terminalId);
  if (sponsorResult.status === "sponsored") {
    clearRegistrationError(dataDir);
    saveCloudCredential(dataDir, sponsorResult.credential);
    return sponsorResult.credential;
  }
  if (sponsorResult.status === "blocked") {
    // PRD 8.1 — bloqueio definitivo do plano; fica assim até o dono liberar
    // mais terminais (o cache local não muda sozinho, só no próximo sync
    // bem-sucedido de outro terminal já autorizado).
    saveRegistrationError(dataDir, sponsorResult.message);
    return null;
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
    clearRegistrationError(dataDir);
    saveCloudCredential(dataDir, credential);
    return credential;
  } catch {
    return null;
  }
}

/**
 * M10 (achado durante o teste, não estava no plano original) — um terminal
 * recém-instalado, sem nenhum operador ainda, não deve tentar se
 * autocadastrar na nuvem: o ciclo de cloud-sync começa a rodar assim que o
 * sidecar sobe, e se isso acontecer antes do dono ter a chance de abrir a
 * tela de Pareamento e adotar o token de um terminal já existente, o
 * terminal novo vira âncora de um estabelecimento separado sem querer —
 * exatamente a corrida que o patrocínio do M9 existe pra evitar, só que
 * baseada em timing em vez de dois terminais subindo juntos. Espera até o
 * terminal ter operador (via bootstrap local OU via sync LAN trazendo os
 * operadores de quem ele pareou) — a mesma decisão que a tela de Login já
 * oferece ("cadastrar o primeiro operador" vs. "parear com outro terminal").
 */
function hasLocalOperators(db: DatabaseSync): boolean {
  return project(sortEvents(listEventsSinceCursor(db))).operators.length > 0;
}

async function runOneSyncCycle(db: DatabaseSync, dataDir: string, terminalId: string): Promise<void> {
  if (loadCloudCredential(dataDir) === null && !hasLocalOperators(db)) return;

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

  // M10 (ARCH §6) — atualiza o cache local do plano a cada ciclo bem-sucedido;
  // enforcement (limite de comandas) sempre lê esse cache, nunca a nuvem
  // diretamente (precisa continuar funcionando 100% offline, NFR1).
  const planRes = await fetch(`${BACKEND_URL}/sync/plan`, { headers, signal: signal() });
  if (planRes.ok) savePlanCache(dataDir, (await planRes.json()) as PlanLimits);
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

import { useEffect, useState } from "react";
import { SIDECAR_URL } from "./sidecar";

export type MergeWarning = { losingOrder: string; canonicalOrder: string; tableId: string; createdAt: number };
type TableRef = { id: string; identifier: string };

/** Achado em uso real (2026-09-22): sem um corte de tempo, um merge continuava aparecendo pra sempre neste terminal, sem forma de dispensar. */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const FIRST_SEEN_STORAGE_KEY = "passa-a-regua:merge-warnings-first-seen";
/** Achado em uso real (2026-09-22): esperar até 24h pra sumir sozinho não bastava — o operador precisa de um jeito explícito de dizer "já vi, pode sumir". */
const DISMISSED_STORAGE_KEY = "passa-a-regua:merge-warnings-dismissed";

/**
 * Data (`Date.now()`) em que ESTE terminal viu cada merge pela primeira
 * vez, por `losingOrder` — não o `createdAt` do evento (esse é hora de
 * quando a comanda perdedora foi aberta, que pode ser dias antes do
 * terminal afetado sincronizar e descobrir o merge; usar `createdAt`
 * pra decidir visibilidade esconderia avisos que acabaram de ser
 * descobertos, contrariando ARCH §4.2: "assim que o terminal que
 * 'perdeu' a comanda sincroniza e recebe o merge, ele exibe..."). Guardado
 * em `localStorage` porque é inerentemente por-terminal — o mesmo merge
 * pode ter sido descoberto em momentos diferentes por terminais diferentes.
 */
function loadFirstSeenMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(FIRST_SEEN_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function saveFirstSeenMap(map: Record<string, number>) {
  try {
    localStorage.setItem(FIRST_SEEN_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage indisponível — degrada pra "sempre mostrar" (sem cortar por tempo), nunca quebra.
  }
}

function loadDismissedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissedSet(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage indisponível — "Dispensar" só não persiste entre reloads, não quebra o clique.
  }
}

/**
 * ARCH §4.2 — decisão explícita de não deixar o merge automático de
 * comanda (duas mesas abertas offline pro mesmo lugar, resolvido por
 * menor HLC) passar em silêncio. Polling simples da projeção, mesmo
 * padrão de `useSidecarHealth`. Só mostra mesclagens que este terminal
 * viu pela primeira vez nas últimas 24h — o histórico completo segue
 * existindo em `mergeWarnings` no sidecar (nada é descartado lá), isso
 * é só um filtro de apresentação local.
 */
export function useMergeWarnings(intervalMs = 4000) {
  const [allRecentWarnings, setAllRecentWarnings] = useState<MergeWarning[]>([]);
  const [tables, setTables] = useState<TableRef[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissedSet());

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch(`${SIDECAR_URL}/state`);
        const data = (await res.json()) as Partial<{ mergeWarnings: MergeWarning[]; tables: TableRef[] }>;
        if (!cancelled) {
          const allWarnings = data.mergeWarnings ?? [];
          const now = Date.now();
          const firstSeen = loadFirstSeenMap();
          let firstSeenChanged = false;
          for (const w of allWarnings) {
            if (!(w.losingOrder in firstSeen)) {
              firstSeen[w.losingOrder] = now;
              firstSeenChanged = true;
            }
          }
          if (firstSeenChanged) saveFirstSeenMap(firstSeen);

          const cutoff = now - RECENT_WINDOW_MS;
          setAllRecentWarnings(allWarnings.filter((w) => (firstSeen[w.losingOrder] ?? now) >= cutoff));
          setTables(data.tables ?? []);
        }
      } catch {
        // Sidecar fora do ar já é sinalizado pelo indicador de status do header — não duplica erro aqui.
      }
    }

    check();
    const interval = setInterval(check, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [intervalMs]);

  function dismiss(losingOrder: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(losingOrder);
      saveDismissedSet(next);
      return next;
    });
  }

  // Mesa pode ter sido removida (PRD 2.8) desde que o merge aconteceu — o
  // vínculo com a mesa é só histórico nesse caso, não "mesa ainda existe e
  // não achamos o nome" (achado em uso real, 2026-09-22: sem isso o rótulo
  // caía pro id cru, ilegível).
  const tableLabel = (tableId: string) => tables.find((t) => t.id === tableId)?.identifier ?? "mesa removida";

  const warnings = allRecentWarnings.filter((w) => !dismissed.has(w.losingOrder));

  return { warnings, tableLabel, dismiss };
}

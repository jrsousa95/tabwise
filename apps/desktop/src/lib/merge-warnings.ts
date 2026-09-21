import { useEffect, useState } from "react";
import { SIDECAR_URL } from "./sidecar";

export type MergeWarning = { losingOrder: string; canonicalOrder: string; tableId: string };
type TableRef = { id: string; identifier: string };

/**
 * ARCH §4.2 — decisão explícita de não deixar o merge automático de
 * comanda (duas mesas abertas offline pro mesmo lugar, resolvido por
 * menor HLC) passar em silêncio. Polling simples da projeção, mesmo
 * padrão de `useSidecarHealth`.
 */
export function useMergeWarnings(intervalMs = 4000) {
  const [warnings, setWarnings] = useState<MergeWarning[]>([]);
  const [tables, setTables] = useState<TableRef[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch(`${SIDECAR_URL}/state`);
        const data = (await res.json()) as Partial<{ mergeWarnings: MergeWarning[]; tables: TableRef[] }>;
        if (!cancelled) {
          setWarnings(data.mergeWarnings ?? []);
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

  const tableLabel = (tableId: string) => tables.find((t) => t.id === tableId)?.identifier ?? tableId;

  return { warnings, tableLabel };
}

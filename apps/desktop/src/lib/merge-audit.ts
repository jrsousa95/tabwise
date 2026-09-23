import { useCallback, useEffect, useState } from "react";
import { SIDECAR_URL } from "./sidecar";

export type MergeAuditEntry = { losingOrder: string; canonicalOrder: string; tableId: string; createdAt: number };
type TableRef = { id: string; identifier: string };

type Status = "loading" | "ready";

/**
 * ARCH §4.2 promete um "registro de auditoria completo... visível ao dono"
 * de mesclagens automáticas de comanda, além da notificação transitória no
 * terminal afetado — mas nunca existiu tela separada pra isso até agora
 * (lacuna registrada em `_bmad-output/implementation-artifacts/
 * deferred-work.md`). Diferente de `useMergeWarnings` (`layout.tsx`), que
 * só mostra o que ESTE terminal viu recentemente (24h) e dá pra dispensar:
 * aqui é o histórico completo vindo direto de `ProjectedState.mergeWarnings`
 * — nenhum filtro de tempo, nenhum "dispensar" (registro permanente).
 */
export function useMergeAudit() {
  const [status, setStatus] = useState<Status>("loading");
  const [entries, setEntries] = useState<MergeAuditEntry[]>([]);
  const [tables, setTables] = useState<TableRef[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${SIDECAR_URL}/state`);
      const data = (await res.json()) as Partial<{ mergeWarnings: MergeAuditEntry[]; tables: TableRef[] }>;
      setEntries(data.mergeWarnings ?? []);
      setTables(data.tables ?? []);
    } catch {
      setEntries([]);
      setTables([]);
    } finally {
      setStatus("ready");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Mesma lógica de `useMergeWarnings`: mesa pode ter sido removida (PRD
  // 2.8) desde que o merge aconteceu — o vínculo é só histórico nesse caso.
  const tableLabel = (tableId: string) => tables.find((t) => t.id === tableId)?.identifier ?? "mesa removida";

  return { status, entries, tableLabel, refresh };
}

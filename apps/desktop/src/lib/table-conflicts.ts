import { useCallback, useEffect, useState } from "react";
import { SIDECAR_URL } from "./sidecar";

export type TableConflict = {
  losingOrder: string;
  canonicalOrder: string;
  tableId: string;
  createdAt: number;
  resolvedAt?: number;
};
type TableRef = { id: string; identifier: string };

type Status = "loading" | "ready";

/**
 * ARCH §4.2 promete um "registro de auditoria completo... visível ao dono"
 * de mesclagens automáticas de comanda (duas `order_opened` pra mesma mesa
 * por terminais offline, resolvidas por menor HLC), além da notificação
 * transitória no terminal afetado — mas nunca existiu tela separada pra
 * isso até 2026-09-23 (lacuna registrada em `_bmad-output/implementation-
 * artifacts/deferred-work.md`). Diferente de `useMergeWarnings`
 * (`layout.tsx`), que só mostra o que ESTE terminal viu recentemente (24h)
 * e dá pra dispensar (por terminal, não sincroniza): aqui é o histórico
 * completo vindo direto de `ProjectedState.mergeWarnings`, e "resolver" é
 * um evento de verdade (`table_conflict_resolved`) que sincroniza entre
 * terminais — nome "conflito de mesa" (não "mesclagem") a pedido do dono,
 * mais claro pra quem não conhece o mecanismo interno.
 */
export function useTableConflicts() {
  const [status, setStatus] = useState<Status>("loading");
  const [conflicts, setConflicts] = useState<TableConflict[]>([]);
  const [tables, setTables] = useState<TableRef[]>([]);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${SIDECAR_URL}/state`);
      const data = (await res.json()) as Partial<{ mergeWarnings: TableConflict[]; tables: TableRef[] }>;
      setConflicts(data.mergeWarnings ?? []);
      setTables(data.tables ?? []);
    } catch {
      setConflicts([]);
      setTables([]);
    } finally {
      setStatus("ready");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function resolve(losingOrder: string) {
    setResolveError(null);
    try {
      const res = await fetch(`${SIDECAR_URL}/orders/${losingOrder}/resolve-conflict`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setResolveError(body?.error ?? "não foi possível marcar como resolvido");
        return;
      }
      refresh();
    } catch {
      setResolveError("não foi possível marcar como resolvido");
    }
  }

  // Mesma lógica de `useMergeWarnings`: mesa pode ter sido removida (PRD
  // 2.8) desde que o conflito aconteceu — o vínculo é só histórico nesse caso.
  const tableLabel = (tableId: string) => tables.find((t) => t.id === tableId)?.identifier ?? "mesa removida";

  return { status, conflicts, tableLabel, resolve, resolveError, refresh };
}

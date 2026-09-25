import { useCallback, useEffect, useState } from "react";
import { SIDECAR_URL } from "./sidecar";

export type TableConflict = {
  losingOrder: string;
  canonicalOrder: string;
  tableId: string;
  createdAt: number;
  resolvedAt?: number;
};

/**
 * Épico 1 (Sessão de Caixa), Story 1.1 / UX-DR4 (decidido com o dono,
 * 2026-09-25) — mesmo mecanismo de conflito por HLC do conflito de mesa,
 * mas pro slot global de sessão de caixa (sem `tableId`). Ainda não existe
 * um evento de "marcar como resolvido" pra esse tipo (`table_conflict_
 * resolved` é só de order) — fica como aviso não bloqueante, sem ação de
 * linha, até essa necessidade aparecer numa story futura.
 */
export type CashSessionConflict = {
  losingSession: string;
  canonicalSession: string;
  createdAt: number;
};

type TableRef = { id: string; identifier: string };

/** Só o suficiente pra identificar uma sessão de caixa numa linha de conflito — ver `CashSessionState` completo em `lib/cash-sessions.ts`. */
type CashSessionRef = { id: string; openingAmountCents: number };

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
  const [cashSessionConflicts, setCashSessionConflicts] = useState<CashSessionConflict[]>([]);
  const [tables, setTables] = useState<TableRef[]>([]);
  const [cashSessions, setCashSessions] = useState<CashSessionRef[]>([]);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${SIDECAR_URL}/state`);
      const data = (await res.json()) as Partial<{
        mergeWarnings: TableConflict[];
        cashSessionMergeWarnings: CashSessionConflict[];
        tables: TableRef[];
        cashSessions: CashSessionRef[];
      }>;
      setConflicts(data.mergeWarnings ?? []);
      setCashSessionConflicts(data.cashSessionMergeWarnings ?? []);
      setTables(data.tables ?? []);
      setCashSessions(data.cashSessions ?? []);
    } catch {
      setConflicts([]);
      setCashSessionConflicts([]);
      setTables([]);
      setCashSessions([]);
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

  /** Achado no review da Story 1.1 (item 9 do Review Triage Log) — timestamp sozinho não identifica qual sessão é qual; o valor de abertura é o único dado disponível em `CashSessionState` que distingue duas sessões pro dono. */
  const cashSessionAmount = (sessionId: string) => cashSessions.find((s) => s.id === sessionId)?.openingAmountCents;

  return { status, conflicts, cashSessionConflicts, tableLabel, cashSessionAmount, resolve, resolveError, refresh };
}

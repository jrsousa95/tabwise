import { useCallback, useEffect, useState } from "react";
import { SIDECAR_URL } from "./sidecar";

/**
 * Épico 1 (Sessão de Caixa), Story 1.1. Espelha `CashSessionState` do
 * sync-engine — `withdrawals`/`deposits`/`closing` chegam vazios/ausentes
 * nesta story (sangria/suprimento/fechamento são 1.2/1.3/1.4, backlog
 * separado), mas já fazem parte do formato pra não quebrar quando forem
 * implementados.
 */
export type CashMovementRecord = {
  id: string;
  amountCents: number;
  reason: string;
  recordedAt: number;
  operatorId: string;
};

export type CashSessionState = {
  id: string;
  status: "open" | "closed";
  openedByTerminalId: string;
  openedByOperatorId: string;
  openingAmountCents: number;
  openedAt: number;
  mergedInto?: string;
  withdrawals: CashMovementRecord[];
  deposits: CashMovementRecord[];
  closing?: { countedAmountCents: number; closedAt: number; closedByOperatorId: string };
};

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Padrão local de `tables.ts:54-63` — cada lib de rota mantém seu próprio
// `postJson`, não um helper HTTP compartilhado.
async function postJson<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  const res = await fetch(`${SIDECAR_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseBody = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, error: (responseBody as { error?: string } | null)?.error ?? "não foi possível completar a ação" };
  }
  return { ok: true, data: responseBody as T };
}

/** PRD Épico 1 (Story 1.1) — abre uma sessão de caixa nova; 400 se já existe uma aberta no estabelecimento. */
export function openCashSession(openingAmountCents: number) {
  return postJson<{ id: string; openingAmountCents: number; openedAt: number }>("/cash-sessions", { openingAmountCents });
}

type Status = "loading" | "ready";

/** Lê `cashSessions` da projeção (`GET /state`) — mesmo padrão de `useTablesAndOrders`. */
export function useCashSessionState() {
  const [status, setStatus] = useState<Status>("loading");
  const [cashSessions, setCashSessions] = useState<CashSessionState[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${SIDECAR_URL}/state`);
      const data = (await res.json()) as Partial<{ cashSessions: CashSessionState[] }>;
      // Fallback pra [] se o sidecar rodando ainda for de uma versão anterior
      // a esta story (mesmo racional de `useTablesAndOrders`).
      setCashSessions(data.cashSessions ?? []);
    } catch {
      setCashSessions([]);
    } finally {
      setStatus("ready");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Invariante do Épico 1: no máximo uma sessão canônica aberta por vez, no
  // estabelecimento inteiro (mesmo filtro de `isCashSessionOpen` no sidecar).
  const openSession = cashSessions.find((s) => s.mergedInto === undefined && s.status === "open");

  return { status, cashSessions, openSession, refresh };
}

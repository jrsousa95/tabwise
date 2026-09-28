import { SIDECAR_URL } from "./sidecar";
import type { CashRegisterSummary } from "./cash-register";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Mesmo padrão de `getJson` de `cash-sessions.ts`/`pairing.ts` — cada lib de
// rota mantém seu próprio helper HTTP, não um cliente compartilhado.
async function getJson<T>(path: string): Promise<ApiResult<T>> {
  const res = await fetch(`${SIDECAR_URL}${path}`);
  const responseBody = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, error: (responseBody as { error?: string } | null)?.error ?? "não foi possível completar a ação" };
  }
  return { ok: true, data: responseBody as T };
}

export type CashRegisterSummaryRange = { current: CashRegisterSummary; previous: CashRegisterSummary };

/**
 * Épico 2 (Story 2.1) — relatório por período, owner-only. Devolve num
 * ÚNICO GET o resumo do intervalo escolhido (`current`) junto com o do
 * período equivalente imediatamente anterior (`previous`, mesma duração em
 * dias, sem semântica de calendário) — nunca precisa de uma segunda chamada
 * de rede pro comparativo.
 */
export function getCashRegisterSummaryRange(from: string, to: string) {
  return getJson<CashRegisterSummaryRange>(`/reports/cash-register/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

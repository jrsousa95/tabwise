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

export type CashRegisterSummaryByOperator = {
  operatorId: string;
  operatorName: string;
  totalSoldCents: number;
  closedOrdersCount: number;
  itemsCanceledCount: number;
};

/**
 * Épico 2 (Story 2.2) — relatório por operador, owner-only, mesmo intervalo
 * de datas do relatório por período. Devolve TODOS os operadores conhecidos
 * (mesmo os sem nenhuma atividade no intervalo, que aparecem zerados),
 * ordenados por `totalSoldCents` desc.
 */
export function getCashRegisterSummaryByOperator(from: string, to: string) {
  return getJson<CashRegisterSummaryByOperator[]>(
    `/reports/cash-register/by-operator?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
}

export type CashRegisterSummaryByProduct = {
  name: string;
  quantitySold: number;
  totalSoldCents: number;
};

/**
 * Épico 2 (Story 2.3) — ranking de produtos (curva ABC), owner-only, mesmo
 * intervalo de datas do relatório por período. Devolve só os produtos
 * vendidos no intervalo (sem entrada zerada pra quem não vendeu nada — ao
 * contrário do relatório por operador, aqui não existe uma lista fixa de
 * "todo produto conhecido"), já ordenado por `totalSoldCents` desc.
 */
export function getCashRegisterSummaryByProduct(from: string, to: string) {
  return getJson<CashRegisterSummaryByProduct[]>(
    `/reports/cash-register/by-product?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
}

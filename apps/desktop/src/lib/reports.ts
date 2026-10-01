import { SIDECAR_URL } from "./sidecar";
import type { CashRegisterSummary } from "./cash-register";
import { formatCentsToBRL } from "./money";

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

export type SummaryDelta = { deltaCents: number; deltaLabel: string; deltaPercent: number | null };

/**
 * Épico 2 (Story 2.1, extraído na Story 2.4) — cálculo da variação do total
 * vendido entre o período escolhido e o período anterior. Fonte única de
 * verdade: reaproveitado tanto pela `ComparisonBlock` (tela) quanto pela
 * exportação CSV, garantindo que os dois NUNCA divirjam no valor exibido.
 * Sem percentual quando o período anterior não vendeu nada (divisão por
 * zero não tem leitura útil) nem quando a variação é zero (redundante com o
 * próprio rótulo "sem variação").
 */
export function computeSummaryDelta(current: CashRegisterSummary, previous: CashRegisterSummary): SummaryDelta {
  const deltaCents = current.totalSoldCents - previous.totalSoldCents;
  const deltaLabel = deltaCents === 0 ? "sem variação" : `${deltaCents > 0 ? "+" : "-"}${formatCentsToBRL(Math.abs(deltaCents))}`;
  const deltaPercent = deltaCents !== 0 && previous.totalSoldCents > 0 ? (deltaCents / previous.totalSoldCents) * 100 : null;
  return { deltaCents, deltaLabel, deltaPercent };
}

/**
 * Combina `deltaLabel` + percentual entre parênteses (quando houver) no
 * texto final de variação — ÚNICA fonte de verdade da string exibida,
 * reaproveitada tanto pela `ComparisonBlock` (tela, `routes/reports.tsx`)
 * quanto pela exportação CSV (`lib/csv.ts`), pra garantir que os dois NUNCA
 * divirjam no texto exibido.
 */
export function formatDelta(deltaLabel: string, deltaPercent: number | null): string {
  if (deltaPercent === null) return deltaLabel;
  return `${deltaLabel} (${deltaPercent > 0 ? "+" : ""}${deltaPercent.toFixed(1)}%)`;
}

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

/** Épico 3 (Story 3.1) — status ATUAL (nunca histórico) da sessão de caixa canônica do estabelecimento inteiro, vindo do relatório consolidado. `status` é sempre `"open"` aqui — ausência de sessão aberta é `cashSession: null`. */
export type ConsolidatedCashSessionSummary = {
  status: "open";
  openedAt: number;
  openingAmountCents: number;
  depositsCents: number;
  withdrawalsCents: number;
  expectedAmountCents: number;
};

export type ConsolidatedCashRegisterReport = CashRegisterSummary & {
  cashSession: ConsolidatedCashSessionSummary | null;
};

/**
 * Épico 3 (Story 3.1) — relatório consolidado multi-terminal, owner-only.
 * Diferente das rotas acima (Épico 2, 100% locais), esta depende de nuvem
 * configurada: o sidecar faz proxy autenticado pra `GET /reports/cash-register`
 * do backend (`GET /reports/cash-register/consolidated` local) e devolve o
 * mesmo formato do relatório do dia + `cashSession`. Sem seletor de
 * intervalo — sempre o snapshot de "hoje" (Design Notes de spec-3-1).
 * `getJson` já devolve a mensagem de erro clara do sidecar tal e qual
 * ("configure a sincronização com a nuvem primeiro" vs. "não foi possível
 * conectar à nuvem agora") — a tela só precisa exibir `error` direto.
 */
export function getConsolidatedCashRegisterReport() {
  return getJson<ConsolidatedCashRegisterReport>("/reports/cash-register/consolidated");
}

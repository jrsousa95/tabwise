import { useCallback, useEffect, useState } from "react";
import { SIDECAR_URL } from "./sidecar";
import type { OrderOrigin } from "./order";

export type CashRegisterSummary = {
  date: string;
  closedOrdersCount: number;
  subtotalCents: number;
  serviceFeeCents: number;
  totalSoldCents: number;
  totalByPaymentMethod: { cash: number; card: number };
  pendingOrders: Array<{ id: string; origin: OrderOrigin; currentTableId?: string }>;
};

type Status = "loading" | "ready";

/** PRD 6.1 — resumo do dia, calculado localmente a partir da réplica (`GET /cash-register/summary`). */
export function useCashRegisterSummary() {
  const [status, setStatus] = useState<Status>("loading");
  const [summary, setSummary] = useState<CashRegisterSummary | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${SIDECAR_URL}/cash-register/summary`);
      const data = (await res.json()) as CashRegisterSummary;
      setSummary(data);
    } catch {
      setSummary(null);
    } finally {
      setStatus("ready");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, summary, refresh };
}

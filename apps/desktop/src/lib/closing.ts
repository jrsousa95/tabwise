import { useCallback, useEffect, useState } from "react";
import { SIDECAR_URL } from "./sidecar";

export type Split = {
  amountCents: number;
  paymentMethod: "cash" | "card";
  cashReceivedCents?: number;
};

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

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

/** PRD 5.1/5.2/5.3/5.4/5.5 — fecha uma comanda sozinha. */
export function closeOrder(orderId: string, input: { serviceFeePercent: number; splits: Split[] }) {
  return postJson<{ totalCents: number }>(`/orders/${orderId}/close`, input);
}

/** PRD 2.6/5.2 — fecha várias comandas de mesas agrupadas numa única operação de pagamento. */
export function closeOrderGroup(orderId: string, input: { orderIds: string[]; serviceFeePercent: number; splits: Split[] }) {
  return postJson<{ combined: { totalCents: number } }>(`/orders/${orderId}/close-group`, input);
}

/** PRD 5.1 — percentual padrão de taxa de serviço do estabelecimento (dono). */
export function updateEstablishmentSettings(defaultServiceFeePercent: number) {
  return postJson<{ defaultServiceFeePercent: number }>("/establishment/settings", { defaultServiceFeePercent });
}

type EstablishmentStatus = "loading" | "ready";

export function useEstablishment() {
  const [status, setStatus] = useState<EstablishmentStatus>("loading");
  const [defaultServiceFeePercent, setDefaultServiceFeePercent] = useState(10);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${SIDECAR_URL}/state`);
      const data = (await res.json()) as Partial<{ establishment: { defaultServiceFeePercent: number } }>;
      setDefaultServiceFeePercent(data.establishment?.defaultServiceFeePercent ?? 10);
    } catch {
      setDefaultServiceFeePercent(10);
    } finally {
      setStatus("ready");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, defaultServiceFeePercent, refresh };
}

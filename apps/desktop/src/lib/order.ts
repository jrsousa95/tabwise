import { useCallback, useEffect, useState } from "react";
import { SIDECAR_URL } from "./sidecar";
import type { CancelReason } from "./cancel-reason";
import { localizeError } from "./server-errors";

export type Item = {
  id: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  note?: string;
  canceled: boolean;
  cancelReason?: CancelReason;
  cancelNote?: string;
};

export type OrderOrigin = { source: "table"; tableId: string } | { source: "standalone"; number: number };

export type OrderDetail = {
  id: string;
  origin: OrderOrigin;
  currentTableId?: string;
  status: "open" | "closed";
  mergedInto?: string;
  items: Item[];
};

type OrderStatus = "loading" | "ready" | "not-found";

/** PRD Épico 4/M6 — uma comanda com seus itens, lida da projeção (`GET /state`). */
export function useOrder(orderId: string | undefined) {
  const [status, setStatus] = useState<OrderStatus>("loading");
  const [order, setOrder] = useState<OrderDetail | null>(null);

  const refresh = useCallback(async () => {
    if (!orderId) return;
    try {
      const res = await fetch(`${SIDECAR_URL}/state`);
      const data = (await res.json()) as Partial<{ orders: OrderDetail[] }>;
      const found = (data.orders ?? []).find((o) => o.id === orderId);
      setOrder(found ?? null);
      setStatus(found ? "ready" : "not-found");
    } catch {
      setOrder(null);
      setStatus("not-found");
    }
  }, [orderId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, order, refresh };
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function postJson<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  const res = await fetch(`${SIDECAR_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseBody = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, error: localizeError((responseBody as { error?: string } | null)?.error ?? "não foi possível completar a ação") };
  }
  return { ok: true, data: responseBody as T };
}

export function addItemToOrder(orderId: string, input: { productId: string; quantity: number; note?: string }) {
  return postJson<{ itemId: string }>(`/orders/${orderId}/items`, input);
}

export function cancelItem(orderId: string, itemId: string, input: { reason: CancelReason; note?: string }) {
  return postJson<{ itemId: string }>(`/orders/${orderId}/items/${itemId}/cancel`, input);
}

export function updateItemNote(orderId: string, itemId: string, note: string | undefined) {
  return postJson<{ itemId: string }>(`/orders/${orderId}/items/${itemId}/note`, { note });
}

export function incrementItemQuantity(orderId: string, itemId: string, deltaQuantity = 1) {
  return postJson<{ itemId: string }>(`/orders/${orderId}/items/${itemId}/increment`, { deltaQuantity });
}


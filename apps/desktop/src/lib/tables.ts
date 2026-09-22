import { useCallback, useEffect, useState } from "react";
import { SIDECAR_URL } from "./sidecar";

export type Table = { id: string; identifier: string; capacity?: number };
export type TableGroup = { id: string; tableIds: string[] };
export type OrderOrigin = { source: "table"; tableId: string } | { source: "standalone"; number: number };
export type Order = {
  id: string;
  origin: OrderOrigin;
  currentTableId?: string;
  status: "open" | "closed";
  mergedInto?: string;
};

type TablesStatus = "loading" | "ready";

/**
 * PRD Épico 2/M5 — mesas e comandas abertas, lidas da projeção (`GET /state`).
 * `tableGroups`/`TableGroup` seguem existindo aqui só pela compatibilidade
 * de leitura de eventos `tables_grouped`/`table_group_dissolved` já
 * gravados em instalações antigas (PRD 2.6, removida em 2026-09-22) — não
 * há mais UI de agrupamento que os crie ou os exiba.
 */
export function useTablesAndOrders() {
  const [status, setStatus] = useState<TablesStatus>("loading");
  const [tables, setTables] = useState<Table[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tableGroups, setTableGroups] = useState<TableGroup[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${SIDECAR_URL}/state`);
      const data = (await res.json()) as Partial<{ tables: Table[]; orders: Order[]; tableGroups: TableGroup[] }>;
      // Fallback pra [] se o sidecar rodando for de uma versão anterior ao M5
      // (não reinicia sozinho com HMR do frontend — achado em teste manual).
      setTables(data.tables ?? []);
      setOrders(data.orders ?? []);
      setTableGroups(data.tableGroups ?? []);
    } catch {
      setTables([]);
      setOrders([]);
      setTableGroups([]);
    } finally {
      setStatus("ready");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, tables, orders, tableGroups, refresh };
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
    return { ok: false, error: (responseBody as { error?: string } | null)?.error ?? "não foi possível completar a ação" };
  }
  return { ok: true, data: responseBody as T };
}

export function createTable(identifier: string, capacity?: number) {
  return postJson<Table>("/tables", capacity === undefined ? { identifier } : { identifier, capacity });
}

export function openTableOrder(tableId: string) {
  return postJson<Order>("/orders", { source: "table", tableId });
}

export function openStandaloneOrder() {
  return postJson<Order>("/orders", { source: "standalone" });
}

export function transferOrder(orderId: string, destinationTableId: string) {
  return postJson<{ id: string }>(`/orders/${orderId}/transfer`, { destinationTableId });
}

/** PRD 2.8 — renomear mesa já cadastrada (identificador e/ou capacidade). */
export function renameTable(id: string, input: { identifier: string; capacity?: number }) {
  return postJson<Table>(`/tables/${id}/rename`, input);
}

/** PRD 2.8 — remover mesa (lógico); 409 se ela tiver comanda aberta agora. */
export async function removeTable(id: string): Promise<ApiResult<void>> {
  const res = await fetch(`${SIDECAR_URL}/tables/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? "não foi possível remover a mesa" };
  }
  return { ok: true, data: undefined };
}


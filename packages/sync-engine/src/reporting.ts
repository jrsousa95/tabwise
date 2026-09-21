import type { OrderState } from "./reconciliation.js";

/** "YYYY-MM-DD" no fuso local de quem está calculando (sidecar: fuso da máquina do usuário; backend: fuso do servidor — ok pro MVP, ambos processam eventos com `createdAt` em epoch ms). */
export function localDateKey(epochMs: number): string {
  const d = new Date(epochMs);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export interface CashRegisterSummary {
  readonly date: string;
  readonly closedOrdersCount: number;
  readonly subtotalCents: number;
  readonly serviceFeeCents: number;
  readonly totalSoldCents: number;
  readonly totalByPaymentMethod: { cash: number; card: number };
  readonly pendingOrders: ReadonlyArray<{ id: string; origin: OrderState["origin"]; currentTableId?: string }>;
}

/**
 * PRD 6.1/6.2 — resumo do dia (fechamento de caixa). Extraído do sidecar
 * (M8) pro `sync-engine` no M11 pra ser reaproveitado tal e qual pelo
 * endpoint de relatório do backend (mesma lógica, duas fontes de `orders`
 * diferentes — projeção local SQLite vs. projeção Postgres) — "sem
 * retrabalho de arquitetura", PRD 6.2 literal.
 */
export function computeCashRegisterSummary(orders: readonly OrderState[], dateKey: string): CashRegisterSummary {
  const closedToday = orders.filter(
    (o) => o.mergedInto === undefined && o.status === "closed" && localDateKey(o.closing!.closedAt) === dateKey
  );
  const pending = orders.filter((o) => o.mergedInto === undefined && o.status === "open");

  const totalByPaymentMethod = { cash: 0, card: 0 };
  for (const order of closedToday) {
    for (const payment of order.payments) {
      totalByPaymentMethod[payment.paymentMethod] += payment.amountCents;
    }
  }

  return {
    date: dateKey,
    closedOrdersCount: closedToday.length,
    subtotalCents: closedToday.reduce((sum, o) => sum + o.closing!.subtotalCents, 0),
    serviceFeeCents: closedToday.reduce((sum, o) => sum + o.closing!.serviceFeeCents, 0),
    totalSoldCents: closedToday.reduce((sum, o) => sum + o.closing!.totalCents, 0),
    totalByPaymentMethod,
    pendingOrders: pending.map((o) => ({ id: o.id, origin: o.origin, currentTableId: o.currentTableId })),
  };
}

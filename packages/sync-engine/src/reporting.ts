import type { OrderState, CashSessionState } from "./reconciliation.js";

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
  readonly totalByPaymentMethod: { cash: number; card: number; pix: number };
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

  const totalByPaymentMethod = { cash: 0, card: 0, pix: 0 };
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

/**
 * Épico 1 (Sessão de Caixa), Story 1.4 — valor esperado da gaveta pra uma
 * sessão de caixa: `openingAmountCents` + pagamentos em dinheiro de `orders`
 * fechadas com `closing.closedAt` dentro de `[session.openedAt,
 * session.closing?.closedAt ?? nowMs]` + suprimentos − sangrias (mesmo
 * padrão de filtro/soma de `computeCashRegisterSummary` acima, mas por
 * intervalo de tempo da sessão em vez de por `dateKey`).
 *
 * Reaproveitada tanto pelo preview (sessão ainda aberta, janela até `nowMs`)
 * quanto pelo histórico (sessão já fechada, janela até `closing.closedAt`) —
 * `expectedAmountCents` NUNCA é persistido, é recalculado a cada leitura
 * (Design Notes de `spec-1-4`). Isso é o que resolve o caso de uma venda em
 * dinheiro que sincroniza depois do fechamento: a próxima leitura já reflete
 * o valor certo, sem evento de correção manual.
 *
 * A correlação NÃO filtra por `terminalId` — a sessão é do estabelecimento
 * inteiro, qualquer terminal pode ter recebido o dinheiro.
 */
export function computeExpectedCashSessionAmountCents(
  session: CashSessionState,
  orders: readonly OrderState[],
  nowMs: number
): number {
  const windowEnd = session.closing?.closedAt ?? nowMs;
  const cashFromOrders = orders
    .filter((o) => o.mergedInto === undefined && o.status === "closed")
    .filter((o) => o.closing!.closedAt >= session.openedAt && o.closing!.closedAt <= windowEnd)
    .reduce((sum, o) => sum + o.payments.filter((p) => p.paymentMethod === "cash").reduce((s, p) => s + p.amountCents, 0), 0);

  // Achado no code review (edge-case-hunter, 2026-09-27): mesma janela
  // aplicada a `orders` acima também precisa valer pra sangria/suprimento —
  // um terminal offline pode registrar uma sangria contra esta sessão
  // enquanto ainda a vê como aberta localmente, e só sincronizar DEPOIS que
  // outro terminal já a fechou (`recordedAt` cai depois de `closing.closedAt`).
  // Sem este filtro, essa sangria/suprimento tardia entraria pra sempre no
  // valor esperado de uma sessão já fechada, mesmo tendo acontecido depois
  // dela ser contada e trancada — diferente do comportamento intencional de
  // AC5 (venda em dinheiro), que é sempre filtrada pela janela da sessão.
  const deposits = session.deposits
    .filter((d) => d.recordedAt >= session.openedAt && d.recordedAt <= windowEnd)
    .reduce((sum, d) => sum + d.amountCents, 0);
  const withdrawals = session.withdrawals
    .filter((w) => w.recordedAt >= session.openedAt && w.recordedAt <= windowEnd)
    .reduce((sum, w) => sum + w.amountCents, 0);

  return session.openingAmountCents + cashFromOrders + deposits - withdrawals;
}

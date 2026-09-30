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
 * Épico 2 (Story 2.1) — agregação compartilhada entre `computeCashRegisterSummary`
 * (dia único) e `computeCashRegisterSummaryForRange` (intervalo) abaixo: soma
 * dos totais sobre uma lista JÁ FILTRADA de comandas fechadas. Quem chama
 * decide o filtro (um `dateKey` ou um intervalo `[from, to]`) — este helper
 * não sabe nada sobre datas.
 */
function aggregateClosedOrders(
  closedOrders: readonly OrderState[]
): Pick<CashRegisterSummary, "closedOrdersCount" | "subtotalCents" | "serviceFeeCents" | "totalSoldCents" | "totalByPaymentMethod"> {
  const totalByPaymentMethod = { cash: 0, card: 0, pix: 0 };
  for (const order of closedOrders) {
    for (const payment of order.payments) {
      totalByPaymentMethod[payment.paymentMethod] += payment.amountCents;
    }
  }

  return {
    closedOrdersCount: closedOrders.length,
    subtotalCents: closedOrders.reduce((sum, o) => sum + o.closing!.subtotalCents, 0),
    serviceFeeCents: closedOrders.reduce((sum, o) => sum + o.closing!.serviceFeeCents, 0),
    totalSoldCents: closedOrders.reduce((sum, o) => sum + o.closing!.totalCents, 0),
    totalByPaymentMethod,
  };
}

/** `pendingOrders` é sempre um retrato de TODAS as comandas abertas AGORA — nunca filtrado por data/intervalo (mesma semântica em `computeCashRegisterSummary` e `computeCashRegisterSummaryForRange`). */
function pendingOrdersSnapshot(orders: readonly OrderState[]): CashRegisterSummary["pendingOrders"] {
  return orders
    .filter((o) => o.mergedInto === undefined && o.status === "open")
    .map((o) => ({ id: o.id, origin: o.origin, currentTableId: o.currentTableId }));
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

  return {
    date: dateKey,
    ...aggregateClosedOrders(closedToday),
    pendingOrders: pendingOrdersSnapshot(orders),
  };
}

/**
 * Épico 2 (Story 2.3) — filtro compartilhado de "comandas fechadas dentro do
 * intervalo": extraído do que já existia inline em
 * `computeCashRegisterSummaryForRange` abaixo, pra ser reaproveitado também
 * por `computeProductRanking` (que precisa da mesma janela, mas iterando os
 * ITENS das orders em vez de agregar `closing.*`). Mesma checagem de sempre:
 * `mergedInto === undefined && status === "closed"` e `closing.closedAt`
 * dentro de `[fromDateKey, toDateKey]` (bounds inclusivos, comparação
 * lexicográfica de string `YYYY-MM-DD`).
 */
function ordersClosedInRange(orders: readonly OrderState[], fromDateKey: string, toDateKey: string): OrderState[] {
  return orders.filter((o) => {
    if (o.mergedInto !== undefined || o.status !== "closed") return false;
    const closedDateKey = localDateKey(o.closing!.closedAt);
    return closedDateKey >= fromDateKey && closedDateKey <= toDateKey;
  });
}

/**
 * Épico 2 (Story 2.1) — relatório por período (`ARCH §3.5`): mesma agregação
 * de `computeCashRegisterSummary` acima, mas sobre um INTERVALO de datas em
 * vez de um único `dateKey`. Bounds INCLUSIVOS nas duas pontas
 * (`fromDateKey <= localDateKey(closedAt) <= toDateKey`), comparação
 * lexicográfica de string `YYYY-MM-DD` — funciona porque o formato tem
 * largura fixa (zero-padded), então ordem lexicográfica === ordem
 * cronológica, sem precisar converter pra `Date`.
 *
 * NÃO altera a assinatura nem o comportamento de `computeCashRegisterSummary`
 * (dois call sites hoje: sidecar M8, backend M11) — função nova, helper
 * interno compartilhado. `pendingOrders` mantém a mesma semântica de sempre:
 * retrato de agora, nunca filtrado pelo intervalo pedido.
 */
export function computeCashRegisterSummaryForRange(
  orders: readonly OrderState[],
  fromDateKey: string,
  toDateKey: string
): CashRegisterSummary {
  const closedInRange = ordersClosedInRange(orders, fromDateKey, toDateKey);

  return {
    date: `${fromDateKey}..${toDateKey}`,
    ...aggregateClosedOrders(closedInRange),
    pendingOrders: pendingOrdersSnapshot(orders),
  };
}

export interface ProductRankingEntry {
  readonly name: string;
  readonly quantitySold: number;
  readonly totalSoldCents: number;
}

/**
 * Épico 2 (Story 2.3) — ranking de produtos vendidos (curva ABC), num
 * intervalo de datas (mesma janela/bounds de `computeCashRegisterSummaryForRange`,
 * via `ordersClosedInRange` compartilhado). Não adiciona nenhum evento novo
 * nem campo retroativo — leitura pura sobre `item_added`/`item_canceled` já
 * materializados em `OrderState[]`.
 *
 * Agrupa por `item.name` (string), não por um id de produto: `item_added`
 * nunca carregou `productId`, só uma cópia própria de `name`/`unitPriceCents`
 * no momento da venda (decisão original: preserva o histórico de vendas
 * mesmo que o produto seja renomeado/removido depois — ver Design Notes de
 * spec-2-3). Item cancelado (`item.canceled === true`) nunca conta, seja qual
 * for o momento do cancelamento.
 *
 * Ordenado por `totalSoldCents` desc (convenção de curva ABC: classificar por
 * contribuição de receita) — `quantitySold` é exposto junto, mas nunca como
 * critério de ordenação primário. Não implementa cortes A/B/C (percentual
 * acumulado de receita) — fora do escopo desta story (Design Notes de
 * spec-2-3).
 */
export function computeProductRanking(orders: readonly OrderState[], fromDateKey: string, toDateKey: string): ProductRankingEntry[] {
  const closedInRange = ordersClosedInRange(orders, fromDateKey, toDateKey);

  const byName = new Map<string, { quantitySold: number; totalSoldCents: number }>();
  for (const order of closedInRange) {
    for (const item of order.items) {
      if (item.canceled) continue;
      const existing = byName.get(item.name) ?? { quantitySold: 0, totalSoldCents: 0 };
      existing.quantitySold += item.quantity;
      existing.totalSoldCents += item.unitPriceCents * item.quantity;
      byName.set(item.name, existing);
    }
  }

  return Array.from(byName.entries())
    .map(([name, totals]) => ({ name, ...totals }))
    // Desempate por nome, determinístico e legível (mesma convenção do
    // relatório por operador, Story 2.2) — empate de `totalSoldCents` é
    // possível entre dois produtos vendidos pelo mesmo valor total.
    .sort((a, b) => b.totalSoldCents - a.totalSoldCents || a.name.localeCompare(b.name));
}

/**
 * Épico 2 (Story 2.2) — cancelamentos de item agrupados por operador, num
 * intervalo de datas (mesmos bounds inclusivos/comparação lexicográfica de
 * `computeCashRegisterSummaryForRange`). Função NOVA (não cabe no helper
 * compartilhado de vendas acima): cancelamento é propriedade de ITEM, não de
 * order — percorre TODOS os itens de TODAS as orders (abertas OU fechadas,
 * `mergedInto === undefined`), janelando por `item.canceledAt` (o único
 * timestamp correto aqui, ver Design Notes de spec-2-2), nunca por
 * `closing.closedAt` da order (que pode nem existir se ela seguir aberta).
 *
 * Devolve um `Map`, não um objeto plano — `JSON.stringify`/`sendJson` NUNCA
 * serializam um `Map` como esperado (vira `{}`). Quem chama sempre precisa
 * ler via `.get(operatorId)` e montar a resposta HTTP à mão a partir disso
 * (achado no code review, 2026-09-29) — nunca passar este retorno direto pra
 * `sendJson`.
 */
export function countCanceledItemsByOperator(
  orders: readonly OrderState[],
  fromDateKey: string,
  toDateKey: string
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const order of orders) {
    if (order.mergedInto !== undefined) continue;
    for (const item of order.items) {
      if (!item.canceled || !item.canceledByOperatorId || item.canceledAt === undefined) continue;
      const canceledDateKey = localDateKey(item.canceledAt);
      if (canceledDateKey < fromDateKey || canceledDateKey > toDateKey) continue;
      counts.set(item.canceledByOperatorId, (counts.get(item.canceledByOperatorId) ?? 0) + 1);
    }
  }
  return counts;
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

/** Épico 3 (Story 3.1) — status ATUAL (nunca histórico, ver `computeConsolidatedCashSessionSummary` abaixo) da sessão de caixa canônica do estabelecimento, consumido pelo relatório consolidado multi-terminal. */
export interface ConsolidatedCashSessionSummary {
  readonly status: "open";
  readonly openedAt: number;
  readonly openingAmountCents: number;
  readonly depositsCents: number;
  readonly withdrawalsCents: number;
  readonly expectedAmountCents: number;
}

/**
 * Epic 3 (Story 3.1) — resumo da sessão de caixa canônica do
 * estabelecimento pra consumo do relatório consolidado multi-terminal
 * (`GET /reports/cash-register` no backend). Descoberta de arquitetura, não
 * evento/projeção nova: os 4 eventos de `cash_session` já são projetados e
 * persistidos no backend desde o Épico 1 — esta função só LÊ o que já
 * existe em `ProjectedState.cashSessions` (mesma projeção usada
 * localmente pelo sidecar, `packages/sync-engine`).
 *
 * Só a sessão CANÔNICA conta (`mergedInto === undefined`) — uma sessão
 * perdedora de um conflito de abertura concorrente (ARCH §4.4) nunca
 * aparece nem é contada, mesmo mesclada. Se não houver canônica com
 * `status === "open"`, devolve `null` — mesma semântica de "nenhuma sessão
 * aberta" já usada localmente em `cash-register.tsx` (Épico 1). Não expõe
 * histórico de sessões encerradas (já existe localmente desde a Story
 * 1.4) — só o status ATUAL.
 *
 * `expectedAmountCents` reaproveita `computeExpectedCashSessionAmountCents`
 * tal e qual (mesma função usada pelo preview de fechamento local).
 *
 * Achado no code review, 2026-09-30 (blind-hunter + edge-case-hunter,
 * achado duplicado): `depositsCents`/`withdrawalsCents` precisam da MESMA
 * janela `[openedAt, nowMs]` que `computeExpectedCashSessionAmountCents` já
 * aplica internamente — a suposição original de que "sessão aberta nunca
 * tem movimento fora da janela" ignorava que este é justamente o relatório
 * MULTI-TERMINAL: um depósito/sangria registrado por outro terminal, com
 * `recordedAt` no relógio DAQUELE terminal (HLC entre relógios diferentes),
 * podia cair depois do `nowMs` calculado pelo BACKEND no momento desta
 * leitura — sem o filtro, "Suprimentos"/"Sangrias" exibidos podiam divergir
 * do "Valor esperado" ao lado, mesmo cálculo, fontes diferentes.
 */
export function computeConsolidatedCashSessionSummary(
  cashSessions: readonly CashSessionState[],
  orders: readonly OrderState[],
  nowMs: number
): ConsolidatedCashSessionSummary | null {
  const canonicalOpenSession = cashSessions.find((s) => s.mergedInto === undefined && s.status === "open");
  if (!canonicalOpenSession) return null;

  const windowEnd = nowMs;
  const inWindow = (recordedAt: number) => recordedAt >= canonicalOpenSession.openedAt && recordedAt <= windowEnd;

  return {
    status: "open",
    openedAt: canonicalOpenSession.openedAt,
    openingAmountCents: canonicalOpenSession.openingAmountCents,
    depositsCents: canonicalOpenSession.deposits.filter((d) => inWindow(d.recordedAt)).reduce((sum, d) => sum + d.amountCents, 0),
    withdrawalsCents: canonicalOpenSession.withdrawals.filter((w) => inWindow(w.recordedAt)).reduce((sum, w) => sum + w.amountCents, 0),
    expectedAmountCents: computeExpectedCashSessionAmountCents(canonicalOpenSession, orders, nowMs),
  };
}

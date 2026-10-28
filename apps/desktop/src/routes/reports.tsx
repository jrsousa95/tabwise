import { useState } from "react";
import {
  getCashRegisterSummaryRange,
  getCashRegisterSummaryByOperator,
  getCashRegisterSummaryByProduct,
  computeSummaryDelta,
  formatDelta,
  type CashRegisterSummaryRange,
  type CashRegisterSummaryByOperator,
  type CashRegisterSummaryByProduct,
} from "../lib/reports";
import { useTablesAndOrders } from "../lib/tables";
import { formatCentsToBRL } from "../lib/money";
import { buildCashRegisterSummaryCsv, downloadCsv } from "../lib/csv";
import type { CashRegisterSummary } from "../lib/cash-register";
import { defineMessages, formatNumber, useMessages } from "../lib/i18n";

const messages = defineMessages({
  pt: {
    closedOrders: (count: number) => `Comandas fechadas: ${count}`,
    subtotal: "Subtotal",
    serviceCharge: "Taxa de serviço",
    totalSold: "Total vendido",
    byPaymentMethod: "Por forma de pagamento",
    cash: "Dinheiro",
    card: "Cartão",
    pix: "Pix",
    comparisonHeading: "Comparativo com o período anterior",
    totalSoldSelected: "Total vendido — período escolhido",
    totalSoldPrevious: "Total vendido — período anterior",
    variance: "Variação",
    byOperatorHeading: "Por operador",
    noOperators: "Nenhum operador cadastrado.",
    operator: "Operador",
    closedOrdersColumn: "Comandas fechadas",
    itemsCanceled: "Itens cancelados",
    byProductHeading: "Por produto",
    noProductsSold: "Nenhum produto vendido no período.",
    product: "Produto",
    quantitySold: "Quantidade vendida",
    tableOrder: (table: string) => `Comanda ${table}`,
    standaloneOrder: (number: string) => `Comanda avulsa #${number}`,
    title: "Relatório por período",
    intro:
      "Escolha um intervalo de datas (bounds inclusivos nas duas pontas) pra ver o resumo agregado e comparar com o período equivalente imediatamente anterior.",
    from: "De",
    fromLabel: "Data inicial do período",
    to: "Até",
    toLabel: "Data final do período",
    viewReport: "Ver relatório",
    loading: "Carregando...",
    csvFilename: (fromDate: string, toDate: string) => `relatorio-periodo-${fromDate}-a-${toDate}.csv`,
    exportCsv: "Exportar CSV",
    selectedPeriod: (fromDate: string, toDate: string) => `Período escolhido (${fromDate} a ${toDate})`,
    previousPeriod: "Período anterior",
    pendingOrdersHeading: (count: number) => `Comandas pendentes (${count})`,
    pendingNotice: "Comandas ainda abertas agora — não entram em nenhum dos dois totais acima.",
    pending: "pendente",
    noPendingOrders: "Nenhuma comanda pendente.",
  },
  en: {
    closedOrders: (count: number) => `Closed tabs: ${count}`,
    subtotal: "Subtotal",
    serviceCharge: "Service charge",
    totalSold: "Total sales",
    byPaymentMethod: "By payment method",
    cash: "Cash",
    card: "Card",
    pix: "Pix",
    comparisonHeading: "Comparison with previous period",
    totalSoldSelected: "Total sales — selected period",
    totalSoldPrevious: "Total sales — previous period",
    variance: "Change",
    byOperatorHeading: "By staff member",
    noOperators: "No staff members added.",
    operator: "Staff member",
    closedOrdersColumn: "Closed tabs",
    itemsCanceled: "Voided items",
    byProductHeading: "By product",
    noProductsSold: "No products sold in this period.",
    product: "Product",
    quantitySold: "Qty sold",
    tableOrder: (table: string) => `${table} tab`,
    standaloneOrder: (number: string) => `Walk-in tab #${number}`,
    title: "Period report",
    intro:
      "Pick a date range (both ends inclusive) to see the combined summary and compare it with the same-length period right before it.",
    from: "From",
    fromLabel: "Period start date",
    to: "To",
    toLabel: "Period end date",
    viewReport: "View report",
    loading: "Loading...",
    csvFilename: (fromDate: string, toDate: string) => `period-report-${fromDate}-to-${toDate}.csv`,
    exportCsv: "Export CSV",
    selectedPeriod: (fromDate: string, toDate: string) => `Selected period (${fromDate} to ${toDate})`,
    previousPeriod: "Previous period",
    pendingOrdersHeading: (count: number) => `Pending tabs (${count})`,
    pendingNotice: "Tabs open right now — not included in either total above.",
    pending: "pending",
    noPendingOrders: "No pending tabs.",
  },
});

/**
 * "YYYY-MM-DD" pro `<input type="date">` — sempre no fuso local de quem
 * está usando o app (mesmo racional de `localDateKey` no sync-engine).
 * Duplica a lógica em vez de importar `localDateKey` porque o frontend não
 * depende de `@tabwise/sync-engine` — só conversa com o sidecar via
 * HTTP (mesmo racional de `localDateKeyForTest` em
 * `apps/desktop/sidecar/test/concurrency-scenario.mjs`).
 */
function todayDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Épico 2 (Story 2.1) — um bloco de resumo (mesma estrutura de "Resumo do
 * dia" de `cash-register.tsx`), reaproveitado tanto pro período escolhido
 * quanto pro período anterior — só o título muda.
 */
function SummaryBlock({ title, summary }: { title: string; summary: CashRegisterSummary }) {
  const m = useMessages(messages);
  return (
    <div className="table-map-section">
      <h2 className="section-heading">{title}</h2>
      <p>{m.closedOrders(summary.closedOrdersCount)}</p>
      <div className="summary">
        <div className="summary-row">
          <span className="type-label">{m.subtotal}</span>
          <span className="amount">{formatCentsToBRL(summary.subtotalCents)}</span>
        </div>
        <div className="summary-row">
          <span className="type-label">{m.serviceCharge}</span>
          <span className="amount">{formatCentsToBRL(summary.serviceFeeCents)}</span>
        </div>
        <div className="summary-row summary-row-total">
          <span className="type-label">{m.totalSold}</span>
          <span className="amount amount-display">{formatCentsToBRL(summary.totalSoldCents)}</span>
        </div>
      </div>

      <h3 className="subsection-heading">{m.byPaymentMethod}</h3>
      <div className="summary">
        <div className="summary-row">
          <span className="type-label">{m.cash}</span>
          <span className="amount">{formatCentsToBRL(summary.totalByPaymentMethod.cash)}</span>
        </div>
        <div className="summary-row">
          <span className="type-label">{m.card}</span>
          <span className="amount">{formatCentsToBRL(summary.totalByPaymentMethod.card)}</span>
        </div>
        <div className="summary-row">
          <span className="type-label">{m.pix}</span>
          <span className="amount">{formatCentsToBRL(summary.totalByPaymentMethod.pix)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Épico 2 (Story 2.1) — comparativo direto entre o período escolhido e o
 * período equivalente anterior (AC: "ao menos um comparativo direto"),
 * baseado no total vendido. Sem percentual quando o período anterior não
 * vendeu nada (divisão por zero não tem leitura útil pro dono).
 */
function ComparisonBlock({ current, previous }: { current: CashRegisterSummary; previous: CashRegisterSummary }) {
  const m = useMessages(messages);
  // Story 2.4 — cálculo e texto final extraídos pra `computeSummaryDelta` /
  // `formatDelta` (lib/reports.ts), reaproveitados também pela exportação
  // CSV, pra garantir que os dois NUNCA divirjam no texto de variação
  // exibido.
  const { deltaLabel, deltaPercent } = computeSummaryDelta(current, previous);
  const deltaText = formatDelta(deltaLabel, deltaPercent);

  return (
    <div className="table-map-section">
      <h2 className="section-heading">{m.comparisonHeading}</h2>
      <div className="summary">
        <div className="summary-row">
          <span className="type-label">{m.totalSoldSelected}</span>
          <span className="amount">{formatCentsToBRL(current.totalSoldCents)}</span>
        </div>
        <div className="summary-row">
          <span className="type-label">{m.totalSoldPrevious}</span>
          <span className="amount">{formatCentsToBRL(previous.totalSoldCents)}</span>
        </div>
        <div className="summary-row summary-row-total">
          <span className="type-label">{m.variance}</span>
          <span className="amount amount-display">{deltaText}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Épico 2 (Story 2.2) — seção nova "Por operador" na MESMA tela `/reports`,
 * disparada pelo mesmo botão "Ver relatório" (mesmo `fromDate`/`toDate`).
 * Lista TODOS os operadores conhecidos (mesmo sem nenhuma venda/cancelamento
 * no período — aparecem zerados, Design Notes de spec-2-2), já ordenados
 * por total vendido desc (mesma ordem devolvida pela rota).
 */
function ByOperatorBlock({ byOperator }: { byOperator: CashRegisterSummaryByOperator[] }) {
  const m = useMessages(messages);
  return (
    <div className="table-map-section">
      <h2 className="section-heading">{m.byOperatorHeading}</h2>
      {byOperator.length === 0 ? (
        <p className="catalog-empty">{m.noOperators}</p>
      ) : (
        <table className="catalog-table">
          <thead>
            <tr>
              <th>{m.operator}</th>
              <th>{m.totalSold}</th>
              <th>{m.closedOrdersColumn}</th>
              <th>{m.itemsCanceled}</th>
            </tr>
          </thead>
          <tbody>
            {byOperator.map((row) => (
              <tr key={row.operatorId}>
                <td>{row.operatorName}</td>
                <td className="amount">{formatCentsToBRL(row.totalSoldCents)}</td>
                <td>{row.closedOrdersCount}</td>
                <td>{row.itemsCanceledCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * Épico 2 (Story 2.3) — seção nova "Por produto" na MESMA tela `/reports`,
 * disparada pelo mesmo botão "Ver relatório" (mesmo `fromDate`/`toDate`).
 * Ao contrário de `ByOperatorBlock`, não existe uma lista fixa de "todo
 * produto conhecido" — só aparece quem vendeu ao menos uma unidade no
 * intervalo (já ordenado por `totalSoldCents` desc, mesma ordem devolvida
 * pela rota — curva ABC: contribuição de receita, não quantidade).
 */
function ByProductBlock({ byProduct }: { byProduct: CashRegisterSummaryByProduct[] }) {
  const m = useMessages(messages);
  return (
    <div className="table-map-section">
      <h2 className="section-heading">{m.byProductHeading}</h2>
      {byProduct.length === 0 ? (
        <p className="catalog-empty">{m.noProductsSold}</p>
      ) : (
        <table className="catalog-table">
          <thead>
            <tr>
              <th>{m.product}</th>
              <th>{m.quantitySold}</th>
              <th>{m.totalSold}</th>
            </tr>
          </thead>
          <tbody>
            {byProduct.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                {/* Achado no code review, 2026-09-29 (blind-hunter): quantidade sem
                    formatação de milhar enquanto o valor ao lado já usa
                    formatCentsToBRL — inconsistente na mesma linha. */}
                <td>{formatNumber(row.quantitySold)}</td>
                <td className="amount">{formatCentsToBRL(row.totalSoldCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * Épico 2 (Story 2.1) — tela nova `/reports`, owner-only (`RequireRole`,
 * `app.tsx`). Dois `<input type="date">` nativos (from/to) — primeiro
 * date-picker do app, sem lib nova (Design Notes de `spec-2-1`). O resumo
 * do período escolhido é mostrado junto do resumo do período equivalente
 * imediatamente anterior (mesma duração em dias, sem semântica de
 * calendário — `computeCashRegisterSummaryForRange`, `reporting.ts`).
 */
function Reports() {
  const m = useMessages(messages);
  const [fromDate, setFromDate] = useState(todayDateKey());
  const [toDate, setToDate] = useState(todayDateKey());
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CashRegisterSummaryRange | null>(null);
  const [byOperator, setByOperator] = useState<CashRegisterSummaryByOperator[] | null>(null);
  const [byProduct, setByProduct] = useState<CashRegisterSummaryByProduct[] | null>(null);
  const { tables } = useTablesAndOrders();

  // Épico 2 (Story 2.3) — o MESMO botão "Ver relatório" dispara as TRÊS
  // chamadas (período + por-operador + por-produto) em paralelo, pro mesmo
  // `fromDate`/`toDate` já selecionado — sem repetir o seletor de datas.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    setError(null);
    const [rangeResponse, byOperatorResponse, byProductResponse] = await Promise.all([
      getCashRegisterSummaryRange(fromDate, toDate),
      getCashRegisterSummaryByOperator(fromDate, toDate),
      getCashRegisterSummaryByProduct(fromDate, toDate),
    ]);
    if (!rangeResponse.ok) {
      setError(rangeResponse.error);
      setStatus("error");
      return;
    }
    if (!byOperatorResponse.ok) {
      setError(byOperatorResponse.error);
      setStatus("error");
      return;
    }
    if (!byProductResponse.ok) {
      setError(byProductResponse.error);
      setStatus("error");
      return;
    }
    setResult(rangeResponse.data);
    setByOperator(byOperatorResponse.data);
    setByProduct(byProductResponse.data);
    setStatus("ready");
  }

  // Achado no code review, 2026-09-28 (blind-hunter): faltava o mesmo
  // fallback "?" que o ramo de mesa já tem, pro caso (raro) de `number` vir
  // ausente numa comanda avulsa.
  const orderLabel = (order: { origin: { source: "table" | "standalone"; number?: number }; currentTableId?: string }) =>
    order.origin.source === "table"
      ? m.tableOrder(tables.find((t) => t.id === order.currentTableId)?.identifier ?? "?")
      : m.standaloneOrder(String(order.origin.number ?? "?"));

  return (
    <section>
      <h1>{m.title}</h1>
      <p>{m.intro}</p>

      <form onSubmit={handleSubmit} className="inline-form">
        <label>
          {m.from}
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label={m.fromLabel}
            required
          />
        </label>
        <label>
          {m.to}
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            // Achado no code review, 2026-09-28 (blind-hunter): sem isso, um
            // intervalo invertido só era percebido depois do 400 do
            // servidor — o próprio seletor nativo já bloqueia escolher uma
            // data "Até" anterior à "De".
            min={fromDate}
            aria-label={m.toLabel}
            required
          />
        </label>
        <button type="submit" className="button-primary" disabled={status === "loading"}>
          {m.viewReport}
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {status === "loading" && <p>{m.loading}</p>}

      {result && status === "ready" && (
        <>
          {/* Story 2.4 — só aparece depois que "Ver relatório" carregou um
              resultado (nunca gera CSV vazio); gera o arquivo 100% no
              navegador, sem chamada nova ao sidecar/backend. Limitação
              conhecida e pré-existente desde a Story 2.1 (ver
              deferred-work.md): se o dono mudar fromDate/toDate sem clicar
              "Ver relatório" de novo, o nome do arquivo/cabeçalho usa as
              datas novas mas o corpo ainda reflete o último fetch. */}
          <button
            type="button"
            className="button-secondary"
            // fromDate/toDate vêm de <input type="date">, sempre "YYYY-MM-DD" — seguro interpolar direto no nome do arquivo.
            onClick={() => downloadCsv(m.csvFilename(fromDate, toDate), buildCashRegisterSummaryCsv(fromDate, toDate, result))}
          >
            {m.exportCsv}
          </button>
          <ComparisonBlock current={result.current} previous={result.previous} />
          <SummaryBlock title={m.selectedPeriod(fromDate, toDate)} summary={result.current} />
          <SummaryBlock title={m.previousPeriod} summary={result.previous} />
          {byOperator && <ByOperatorBlock byOperator={byOperator} />}
          {byProduct && <ByProductBlock byProduct={byProduct} />}

          {/* PRD/ARCH — `pendingOrders` é sempre um retrato de AGORA, nunca
              filtrado pelo intervalo pedido (mesma semântica do Resumo de
              Caixa, Épico 6); mostrado uma única vez (idêntico em `current` e
              `previous`, mesmo cálculo). */}
          <div className="table-map-section">
            <h2 className="section-heading">{m.pendingOrdersHeading(result.current.pendingOrders.length)}</h2>
            <p>{m.pendingNotice}</p>
            <ul className="catalog-list">
              {result.current.pendingOrders.map((o) => (
                <li key={o.id}>
                  <a href={`#/orders/${o.id}`}>{orderLabel(o)}</a>
                  <span className="status-badge status-badge-warning">{m.pending}</span>
                </li>
              ))}
              {result.current.pendingOrders.length === 0 && <li className="catalog-empty">{m.noPendingOrders}</li>}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

export default Reports;

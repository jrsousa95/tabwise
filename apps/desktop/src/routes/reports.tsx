import { useState } from "react";
import {
  getCashRegisterSummaryRange,
  getCashRegisterSummaryByOperator,
  getCashRegisterSummaryByProduct,
  type CashRegisterSummaryRange,
  type CashRegisterSummaryByOperator,
  type CashRegisterSummaryByProduct,
} from "../lib/reports";
import { useTablesAndOrders } from "../lib/tables";
import { formatCentsToBRL } from "../lib/money";
import type { CashRegisterSummary } from "../lib/cash-register";

/**
 * "YYYY-MM-DD" pro `<input type="date">` — sempre no fuso local de quem
 * está usando o app (mesmo racional de `localDateKey` no sync-engine).
 * Duplica a lógica em vez de importar `localDateKey` porque o frontend não
 * depende de `@passa-a-regua/sync-engine` — só conversa com o sidecar via
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
  return (
    <div className="table-map-section">
      <h2 className="section-heading">{title}</h2>
      <p>Comandas fechadas: {summary.closedOrdersCount}</p>
      <div className="summary">
        <div className="summary-row">
          <span className="type-label">Subtotal</span>
          <span className="amount">{formatCentsToBRL(summary.subtotalCents)}</span>
        </div>
        <div className="summary-row">
          <span className="type-label">Taxa de serviço</span>
          <span className="amount">{formatCentsToBRL(summary.serviceFeeCents)}</span>
        </div>
        <div className="summary-row summary-row-total">
          <span className="type-label">Total vendido</span>
          <span className="amount amount-display">{formatCentsToBRL(summary.totalSoldCents)}</span>
        </div>
      </div>

      <h3 className="subsection-heading">Por forma de pagamento</h3>
      <div className="summary">
        <div className="summary-row">
          <span className="type-label">Dinheiro</span>
          <span className="amount">{formatCentsToBRL(summary.totalByPaymentMethod.cash)}</span>
        </div>
        <div className="summary-row">
          <span className="type-label">Cartão</span>
          <span className="amount">{formatCentsToBRL(summary.totalByPaymentMethod.card)}</span>
        </div>
        <div className="summary-row">
          <span className="type-label">Pix</span>
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
  const deltaCents = current.totalSoldCents - previous.totalSoldCents;
  const deltaLabel = deltaCents === 0 ? "sem variação" : `${deltaCents > 0 ? "+" : "-"}${formatCentsToBRL(Math.abs(deltaCents))}`;
  // Achado no code review, 2026-09-28 (blind-hunter): antes mostrava "sem
  // variação (0.0%)" quando deltaCents === 0 — percentual redundante junto
  // do próprio rótulo "sem variação". Suprimido nesse caso.
  const deltaPercent = deltaCents !== 0 && previous.totalSoldCents > 0 ? (deltaCents / previous.totalSoldCents) * 100 : null;

  return (
    <div className="table-map-section">
      <h2 className="section-heading">Comparativo com o período anterior</h2>
      <div className="summary">
        <div className="summary-row">
          <span className="type-label">Total vendido — período escolhido</span>
          <span className="amount">{formatCentsToBRL(current.totalSoldCents)}</span>
        </div>
        <div className="summary-row">
          <span className="type-label">Total vendido — período anterior</span>
          <span className="amount">{formatCentsToBRL(previous.totalSoldCents)}</span>
        </div>
        <div className="summary-row summary-row-total">
          <span className="type-label">Variação</span>
          <span className="amount amount-display">
            {deltaLabel}
            {deltaPercent !== null && ` (${deltaPercent > 0 ? "+" : ""}${deltaPercent.toFixed(1)}%)`}
          </span>
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
  return (
    <div className="table-map-section">
      <h2 className="section-heading">Por operador</h2>
      {byOperator.length === 0 ? (
        <p className="catalog-empty">Nenhum operador cadastrado.</p>
      ) : (
        <table className="catalog-table">
          <thead>
            <tr>
              <th>Operador</th>
              <th>Total vendido</th>
              <th>Comandas fechadas</th>
              <th>Itens cancelados</th>
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
  return (
    <div className="table-map-section">
      <h2 className="section-heading">Por produto</h2>
      {byProduct.length === 0 ? (
        <p className="catalog-empty">Nenhum produto vendido no período.</p>
      ) : (
        <table className="catalog-table">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Quantidade vendida</th>
              <th>Total vendido</th>
            </tr>
          </thead>
          <tbody>
            {byProduct.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{row.quantitySold}</td>
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
      ? `Comanda ${tables.find((t) => t.id === order.currentTableId)?.identifier ?? "?"}`
      : `Comanda avulsa #${order.origin.number ?? "?"}`;

  return (
    <section>
      <h1>Relatório por período</h1>
      <p>Escolha um intervalo de datas (bounds inclusivos nas duas pontas) pra ver o resumo agregado e comparar com o período equivalente imediatamente anterior.</p>

      <form onSubmit={handleSubmit} className="inline-form">
        <label>
          De
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="Data inicial do período"
            required
          />
        </label>
        <label>
          Até
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            // Achado no code review, 2026-09-28 (blind-hunter): sem isso, um
            // intervalo invertido só era percebido depois do 400 do
            // servidor — o próprio seletor nativo já bloqueia escolher uma
            // data "Até" anterior à "De".
            min={fromDate}
            aria-label="Data final do período"
            required
          />
        </label>
        <button type="submit" className="button-primary" disabled={status === "loading"}>
          Ver relatório
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {status === "loading" && <p>Carregando...</p>}

      {result && status === "ready" && (
        <>
          <ComparisonBlock current={result.current} previous={result.previous} />
          <SummaryBlock title={`Período escolhido (${fromDate} a ${toDate})`} summary={result.current} />
          <SummaryBlock title="Período anterior" summary={result.previous} />
          {byOperator && <ByOperatorBlock byOperator={byOperator} />}
          {byProduct && <ByProductBlock byProduct={byProduct} />}

          {/* PRD/ARCH — `pendingOrders` é sempre um retrato de AGORA, nunca
              filtrado pelo intervalo pedido (mesma semântica do Resumo de
              Caixa, Épico 6); mostrado uma única vez (idêntico em `current` e
              `previous`, mesmo cálculo). */}
          <div className="table-map-section">
            <h2 className="section-heading">Comandas pendentes ({result.current.pendingOrders.length})</h2>
            <p>Comandas ainda abertas agora — não entram em nenhum dos dois totais acima.</p>
            <ul className="catalog-list">
              {result.current.pendingOrders.map((o) => (
                <li key={o.id}>
                  <a href={`#/orders/${o.id}`}>{orderLabel(o)}</a>
                  <span className="status-badge status-badge-warning">pendente</span>
                </li>
              ))}
              {result.current.pendingOrders.length === 0 && <li className="catalog-empty">Nenhuma comanda pendente.</li>}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

export default Reports;

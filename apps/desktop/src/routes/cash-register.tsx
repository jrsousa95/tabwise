import { useCashRegisterSummary } from "../lib/cash-register";
import { useTablesAndOrders } from "../lib/tables";
import { formatCentsToBRL } from "../lib/money";

/** PRD Épico 6.1 (M8) — resumo do dia, calculado só da réplica local. Renomeado de "Fechamento de Caixa" (emenda 2026-09-22): é um relatório ao vivo, nunca houve ação de fechamento. */
function CashRegister() {
  const { status, summary } = useCashRegisterSummary();
  const { tables } = useTablesAndOrders();

  if (status === "loading" || !summary) {
    return (
      <section>
        <p>Carregando...</p>
      </section>
    );
  }

  const orderLabel = (order: {
    origin: { source: "table" | "standalone"; number?: number };
    currentTableId?: string;
  }) =>
    order.origin.source === "table"
      ? `Comanda ${tables.find((t) => t.id === order.currentTableId)?.identifier ?? "?"}`
      : `Comanda avulsa #${order.origin.number}`;

  return (
    <section>
      <h1>Resumo de Caixa — {summary.date}</h1>
      {/* Achado na validação de UX, 2026-09-23: .type-label (rótulo 13px)
          usado em parágrafo explicativo em vez de texto corrido — mais
          difícil de ler rápido, justo onde o dono precisa disso. */}
      <p>
        Atualiza a cada consulta, em tempo real — não existe uma ação de fechar
        o caixa.
      </p>

      <div className="table-map-section">
        <h2 className="section-heading">Resumo do dia</h2>
        <p>
          Comandas fechadas: {summary.closedOrdersCount}
        </p>
        <div className="summary">
          <div className="summary-row">
            <span className="type-label">Subtotal</span>
            <span className="amount">
              {formatCentsToBRL(summary.subtotalCents)}
            </span>
          </div>
          <div className="summary-row">
            <span className="type-label">Taxa de serviço</span>
            <span className="amount">
              {formatCentsToBRL(summary.serviceFeeCents)}
            </span>
          </div>
          <div className="summary-row summary-row-total">
            <span className="type-label">Total vendido</span>
            <span className="amount amount-display">
              {formatCentsToBRL(summary.totalSoldCents)}
            </span>
          </div>
        </div>

        <h3 className="subsection-heading">Por forma de pagamento</h3>
        <div className="summary">
          <div className="summary-row">
            <span className="type-label">Dinheiro</span>
            <span className="amount">
              {formatCentsToBRL(summary.totalByPaymentMethod.cash)}
            </span>
          </div>
          <div className="summary-row">
            <span className="type-label">Cartão</span>
            <span className="amount">
              {formatCentsToBRL(summary.totalByPaymentMethod.card)}
            </span>
          </div>
          <div className="summary-row">
            <span className="type-label">Pix</span>
            <span className="amount">
              {formatCentsToBRL(summary.totalByPaymentMethod.pix)}
            </span>
          </div>
        </div>
      </div>

      <div className="table-map-section">
        <h2 className="section-heading">Comandas pendentes ({summary.pendingOrders.length})</h2>
        <p>
          Comandas ainda abertas não entram no total fechado acima.
        </p>
        <ul className="catalog-list">
          {summary.pendingOrders.map((o) => (
            <li key={o.id}>
              <a href={`#/orders/${o.id}`}>{orderLabel(o)}</a>
              <span className="status-badge status-badge-warning">
                pendente
              </span>
            </li>
          ))}
          {summary.pendingOrders.length === 0 && (
            <li className="catalog-empty">Nenhuma comanda pendente.</li>
          )}
        </ul>
      </div>
    </section>
  );
}

export default CashRegister;

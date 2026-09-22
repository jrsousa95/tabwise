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
      <h2>Resumo de Caixa — {summary.date}</h2>
      <p className="type-label">
        Atualiza a cada consulta, em tempo real — não existe uma ação de fechar
        o caixa.
      </p>

      <div className="table-map-section">
        <h3>Resumo do dia</h3>
        <p className="type-label">
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

        <h4>Por forma de pagamento</h4>
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
        <h3>Comandas pendentes ({summary.pendingOrders.length})</h3>
        <p className="type-label">
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

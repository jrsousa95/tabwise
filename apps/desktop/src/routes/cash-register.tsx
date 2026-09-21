import { useCashRegisterSummary } from "../lib/cash-register";
import { useTablesAndOrders } from "../lib/tables";
import { formatCentsToBRL } from "../lib/money";

/** PRD Épico 6.1 (M8) — resumo do dia, calculado só da réplica local. */
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

  const orderLabel = (order: { origin: { source: "table" | "standalone"; number?: number }; currentTableId?: string }) =>
    order.origin.source === "table"
      ? `Mesa ${tables.find((t) => t.id === order.currentTableId)?.identifier ?? "?"}`
      : `Comanda avulsa #${order.origin.number}`;

  return (
    <section>
      <h2>Fechamento de Caixa — {summary.date}</h2>

      <div className="table-map-section">
        <h3>Resumo do dia</h3>
        <p>
          Comandas fechadas: {summary.closedOrdersCount}
          <br />
          Subtotal: {formatCentsToBRL(summary.subtotalCents)}
          <br />
          Taxa de serviço: {formatCentsToBRL(summary.serviceFeeCents)}
          <br />
          <strong>Total vendido: {formatCentsToBRL(summary.totalSoldCents)}</strong>
        </p>

        <h4>Por forma de pagamento</h4>
        <p>
          Dinheiro: {formatCentsToBRL(summary.totalByPaymentMethod.cash)}
          <br />
          Cartão: {formatCentsToBRL(summary.totalByPaymentMethod.card)}
        </p>
      </div>

      <div className="table-map-section">
        <h3>Comandas pendentes ({summary.pendingOrders.length})</h3>
        <p className="form-error">Comandas ainda abertas não entram no total fechado acima.</p>
        <ul className="catalog-list">
          {summary.pendingOrders.map((o) => (
            <li key={o.id}>
              <a href={`#/orders/${o.id}`}>{orderLabel(o)}</a>
            </li>
          ))}
          {summary.pendingOrders.length === 0 && <li className="catalog-empty">Nenhuma comanda pendente.</li>}
        </ul>
      </div>
    </section>
  );
}

export default CashRegister;

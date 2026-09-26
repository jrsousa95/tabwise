import { useState } from "react";
import { useCashRegisterSummary } from "../lib/cash-register";
import { useTablesAndOrders } from "../lib/tables";
import { useCashSessionState, openCashSession } from "../lib/cash-sessions";
import { formatCentsToBRL, parseReaisToCents } from "../lib/money";

/**
 * Épico 1 (Sessão de Caixa), Story 1.1 — abertura de sessão. Decisão
 * confirmada com o dono, 2026-09-25 (ver `spec-1-1-abrir-sessão-de-caixa.md`):
 * vive DENTRO desta tela existente, como bloco novo no topo — não é rota
 * nova nem item de nav novo, e não substitui o resumo do dia abaixo (Épico
 * 6, `useCashRegisterSummary`), que continua sendo um relatório somativo
 * recalculado a cada consulta, sem nenhuma ação de fechamento.
 */
function CashSessionSection() {
  const { status, openSession, refresh } = useCashSessionState();
  const [amountText, setAmountText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleOpen(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const cents = parseReaisToCents(amountText);
    if (cents === null || cents <= 0) {
      setError("valor de abertura inválido");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await openCashSession(cents);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      // Achado no code review, 2026-09-26: o erro mais comum aqui é "já
      // existe uma sessão aberta" (outro terminal/operador venceu a corrida)
      // — sem isso, o formulário continuava exibido em vez de transicionar
      // pra mostrar a sessão que já existe.
      refresh();
      return;
    }
    setAmountText("");
    refresh();
  }

  return (
    <div className="table-map-section">
      <h2 className="section-heading">Sessão de Caixa</h2>
      {status === "loading" ? (
        <p>Carregando...</p>
      ) : openSession ? (
        <p>
          Sessão aberta desde{" "}
          {new Date(openSession.openedAt).toLocaleString("pt-BR")} — fundo de
          troco inicial de {formatCentsToBRL(openSession.openingAmountCents)}.
        </p>
      ) : (
        <>
          <p>Nenhuma sessão de caixa aberta. Informe o valor inicial da gaveta (fundo de troco) pra abrir uma.</p>
          <form onSubmit={handleOpen} className="inline-form">
            <input
              value={amountText}
              onChange={(e) => {
                setAmountText(e.target.value.replace(/[^0-9,.]/g, ""));
                setError(null);
              }}
              disabled={submitting}
              inputMode="decimal"
              placeholder="Ex: 100,00"
              aria-label="Valor de abertura (fundo de troco)"
            />
            <button type="submit" className="button-primary" disabled={submitting}>
              Abrir sessão
            </button>
          </form>
          {error && <p className="form-error" role="alert">{error}</p>}
        </>
      )}
    </div>
  );
}

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

      <CashSessionSection />

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

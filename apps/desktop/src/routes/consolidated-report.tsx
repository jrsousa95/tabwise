import { useCallback, useEffect, useState } from "react";
import { getConsolidatedCashRegisterReport, type ConsolidatedCashRegisterReport } from "../lib/reports";
import { formatCentsToBRL } from "../lib/money";

type Status = "loading" | "ready" | "error";

/**
 * Épico 3 (Story 3.1) — relatório consolidado multi-terminal, tela NOVA e
 * SEPARADA de `/reports` (Épico 2): o dono do estabelecimento vê aqui o
 * caixa agregado de TODOS os terminais já sincronizados com a nuvem, sem
 * precisar consultar o backend manualmente. Owner-only (`RequireRole`,
 * `app.tsx`) — natureza diferente das telas de `/reports`, que são 100%
 * locais/sempre disponíveis: esta depende de uma pré-condição estrutural
 * (nuvem configurada) e mostra um snapshot de "agora"/"hoje", sem seletor
 * de intervalo de datas (Design Notes de spec-3-1).
 *
 * Carrega uma única vez ao montar — sem formulário, sem parâmetro nenhum
 * pro dono escolher, ao contrário de `reports.tsx`.
 */
function ConsolidatedReport() {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ConsolidatedCashRegisterReport | null>(null);

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError(null);
    const result = await getConsolidatedCashRegisterReport();
    if (!result.ok) {
      // `result.error` já vem com a mensagem certa do sidecar — tanto faz
      // se é "nuvem não configurada" (400) ou "nuvem indisponível" (502),
      // as duas são mensagens claras e diferentes entre si, nunca um erro
      // genérico (AC literal da spec-3-1).
      setError(result.error);
      setStatus("error");
      return;
    }
    setReport(result.data);
    setStatus("ready");
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <section>
      <h1>Relatório Consolidado (todos os terminais)</h1>
      <p>
        Snapshot de agora, agregando vendas e sessão de caixa de todos os terminais do estabelecimento já
        sincronizados com a nuvem — sem seletor de datas, sempre "hoje".
      </p>

      <button type="button" className="button-secondary" onClick={refresh} disabled={status === "loading"}>
        Atualizar
      </button>

      {status === "loading" && <p>Carregando...</p>}

      {status === "error" && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {status === "ready" && report && (
        <>
          <div className="table-map-section">
            <h2 className="section-heading">Sessão de caixa</h2>
            {report.cashSession ? (
              <>
                <p>
                  Sessão aberta desde {new Date(report.cashSession.openedAt).toLocaleString("pt-BR")} — fundo de
                  troco inicial de {formatCentsToBRL(report.cashSession.openingAmountCents)}.
                </p>
                <div className="summary">
                  <div className="summary-row">
                    <span className="type-label">Suprimentos</span>
                    <span className="amount">{formatCentsToBRL(report.cashSession.depositsCents)}</span>
                  </div>
                  <div className="summary-row">
                    <span className="type-label">Sangrias</span>
                    <span className="amount">{formatCentsToBRL(report.cashSession.withdrawalsCents)}</span>
                  </div>
                  <div className="summary-row summary-row-total">
                    <span className="type-label">Valor esperado na gaveta (agora)</span>
                    <span className="amount amount-display">{formatCentsToBRL(report.cashSession.expectedAmountCents)}</span>
                  </div>
                </div>
              </>
            ) : (
              <p className="catalog-empty">Nenhuma sessão de caixa aberta no momento.</p>
            )}
          </div>

          <div className="table-map-section">
            <h2 className="section-heading">Vendas — {report.date}</h2>
            <p>Comandas fechadas: {report.closedOrdersCount}</p>
            <div className="summary">
              <div className="summary-row">
                <span className="type-label">Subtotal</span>
                <span className="amount">{formatCentsToBRL(report.subtotalCents)}</span>
              </div>
              <div className="summary-row">
                <span className="type-label">Taxa de serviço</span>
                <span className="amount">{formatCentsToBRL(report.serviceFeeCents)}</span>
              </div>
              <div className="summary-row summary-row-total">
                <span className="type-label">Total vendido</span>
                <span className="amount amount-display">{formatCentsToBRL(report.totalSoldCents)}</span>
              </div>
            </div>

            <h3 className="subsection-heading">Por forma de pagamento</h3>
            <div className="summary">
              <div className="summary-row">
                <span className="type-label">Dinheiro</span>
                <span className="amount">{formatCentsToBRL(report.totalByPaymentMethod.cash)}</span>
              </div>
              <div className="summary-row">
                <span className="type-label">Cartão</span>
                <span className="amount">{formatCentsToBRL(report.totalByPaymentMethod.card)}</span>
              </div>
              <div className="summary-row">
                <span className="type-label">Pix</span>
                <span className="amount">{formatCentsToBRL(report.totalByPaymentMethod.pix)}</span>
              </div>
            </div>

            {/* Retrato de agora, de TODOS os terminais — mesma semântica de
                `pendingOrders` já usada em `cash-register.tsx`/`reports.tsx`,
                sem navegação pra comanda (esta tela não tem acesso à lista
                local de mesas de outros terminais). */}
            <p>Comandas pendentes agora (todos os terminais): {report.pendingOrders.length}</p>
          </div>
        </>
      )}
    </section>
  );
}

export default ConsolidatedReport;

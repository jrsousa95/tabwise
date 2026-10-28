import { useCallback, useEffect, useState } from "react";
import { getConsolidatedCashRegisterReport, type ConsolidatedCashRegisterReport } from "../lib/reports";
import { formatCentsToBRL } from "../lib/money";
import { defineMessages, useMessages, formatDateTime } from "../lib/i18n";

type Status = "loading" | "ready" | "error";

const messages = defineMessages({
  pt: {
    title: "Relatório Consolidado (todos os terminais)",
    intro:
      'Snapshot de agora, agregando vendas e sessão de caixa de todos os terminais do estabelecimento já sincronizados com a nuvem — sem seletor de datas, sempre "hoje".',
    refresh: "Atualizar",
    loading: "Carregando...",
    cashSessionHeading: "Sessão de caixa",
    sessionOpenSince: (openedAt: string, openingAmount: string) =>
      `Sessão aberta desde ${openedAt} — fundo de troco inicial de ${openingAmount}.`,
    deposits: "Suprimentos",
    withdrawals: "Sangrias",
    expectedInDrawer: "Valor esperado na gaveta (agora)",
    noOpenCashSession: "Nenhuma sessão de caixa aberta no momento.",
    salesHeading: (date: string) => `Vendas — ${date}`,
    closedOrders: (count: number) => `Comandas fechadas: ${count}`,
    subtotal: "Subtotal",
    serviceFee: "Taxa de serviço",
    totalSold: "Total vendido",
    byPaymentMethod: "Por forma de pagamento",
    cash: "Dinheiro",
    card: "Cartão",
    pix: "Pix",
    pendingOrders: (count: number) => `Comandas pendentes agora (todos os terminais): ${count}`,
  },
  en: {
    title: "Consolidated Report (all terminals)",
    intro:
      'A snapshot of right now, combining sales and cash sessions from every venue terminal already synced to the cloud — no date picker, always "today".',
    refresh: "Refresh",
    loading: "Loading...",
    cashSessionHeading: "Cash session",
    sessionOpenSince: (openedAt: string, openingAmount: string) =>
      `Session open since ${openedAt} — opening float of ${openingAmount}.`,
    deposits: "Pay-ins",
    withdrawals: "Pay-outs",
    expectedInDrawer: "Expected in drawer (now)",
    noOpenCashSession: "No cash session open right now.",
    salesHeading: (date: string) => `Sales — ${date}`,
    closedOrders: (count: number) => `Closed tabs: ${count}`,
    subtotal: "Subtotal",
    serviceFee: "Service charge",
    totalSold: "Total sales",
    byPaymentMethod: "By payment method",
    cash: "Cash",
    card: "Card",
    pix: "Pix",
    pendingOrders: (count: number) => `Open tabs right now (all terminals): ${count}`,
  },
});

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
  const m = useMessages(messages);
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
      <h1>{m.title}</h1>
      <p>{m.intro}</p>

      <button type="button" className="button-secondary" onClick={refresh} disabled={status === "loading"}>
        {m.refresh}
      </button>

      {status === "loading" && <p>{m.loading}</p>}

      {status === "error" && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {status === "ready" && report && (
        <>
          <div className="table-map-section">
            <h2 className="section-heading">{m.cashSessionHeading}</h2>
            {report.cashSession ? (
              <>
                <p>
                  {m.sessionOpenSince(
                    formatDateTime(report.cashSession.openedAt),
                    formatCentsToBRL(report.cashSession.openingAmountCents),
                  )}
                </p>
                <div className="summary">
                  <div className="summary-row">
                    <span className="type-label">{m.deposits}</span>
                    <span className="amount">{formatCentsToBRL(report.cashSession.depositsCents)}</span>
                  </div>
                  <div className="summary-row">
                    <span className="type-label">{m.withdrawals}</span>
                    <span className="amount">{formatCentsToBRL(report.cashSession.withdrawalsCents)}</span>
                  </div>
                  <div className="summary-row summary-row-total">
                    <span className="type-label">{m.expectedInDrawer}</span>
                    <span className="amount amount-display">{formatCentsToBRL(report.cashSession.expectedAmountCents)}</span>
                  </div>
                </div>
              </>
            ) : (
              <p className="catalog-empty">{m.noOpenCashSession}</p>
            )}
          </div>

          <div className="table-map-section">
            <h2 className="section-heading">{m.salesHeading(report.date)}</h2>
            <p>{m.closedOrders(report.closedOrdersCount)}</p>
            <div className="summary">
              <div className="summary-row">
                <span className="type-label">{m.subtotal}</span>
                <span className="amount">{formatCentsToBRL(report.subtotalCents)}</span>
              </div>
              <div className="summary-row">
                <span className="type-label">{m.serviceFee}</span>
                <span className="amount">{formatCentsToBRL(report.serviceFeeCents)}</span>
              </div>
              <div className="summary-row summary-row-total">
                <span className="type-label">{m.totalSold}</span>
                <span className="amount amount-display">{formatCentsToBRL(report.totalSoldCents)}</span>
              </div>
            </div>

            <h3 className="subsection-heading">{m.byPaymentMethod}</h3>
            <div className="summary">
              <div className="summary-row">
                <span className="type-label">{m.cash}</span>
                <span className="amount">{formatCentsToBRL(report.totalByPaymentMethod.cash)}</span>
              </div>
              <div className="summary-row">
                <span className="type-label">{m.card}</span>
                <span className="amount">{formatCentsToBRL(report.totalByPaymentMethod.card)}</span>
              </div>
              <div className="summary-row">
                <span className="type-label">{m.pix}</span>
                <span className="amount">{formatCentsToBRL(report.totalByPaymentMethod.pix)}</span>
              </div>
            </div>

            {/* Retrato de agora, de TODOS os terminais — mesma semântica de
                `pendingOrders` já usada em `cash-register.tsx`/`reports.tsx`,
                sem navegação pra comanda (esta tela não tem acesso à lista
                local de mesas de outros terminais). */}
            <p>{m.pendingOrders(report.pendingOrders.length)}</p>
          </div>
        </>
      )}
    </section>
  );
}

export default ConsolidatedReport;

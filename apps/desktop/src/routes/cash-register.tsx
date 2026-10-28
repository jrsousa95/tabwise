import { useEffect, useRef, useState } from "react";
import { useCashRegisterSummary } from "../lib/cash-register";
import { useTablesAndOrders } from "../lib/tables";
import {
  useCashSessionState,
  openCashSession,
  recordWithdrawal,
  recordDeposit,
  getExpectedAmount,
  closeCashSession,
  type CashMovementRecord,
  type CashSessionState,
} from "../lib/cash-sessions";
import { formatCentsToBRL, parseReaisToCents } from "../lib/money";
import { defineMessages, formatDateTime, useMessages } from "../lib/i18n";

const messages = defineMessages({
  pt: {
    noDifference: "sem diferença",
    surplus: (amount: string) => `sobra de ${amount}`,
    shortage: (amount: string) => `falta de ${amount}`,
    withdrawalInvalidAmount: "valor da sangria inválido",
    withdrawalReasonRequired: "motivo da sangria é obrigatório",
    withdrawalHeading: "Sangria",
    withdrawalAmountPlaceholder: "Ex: 20,00",
    withdrawalAmountLabel: "Valor da sangria",
    withdrawalReasonPlaceholder: "Motivo (ex: reforço de troco pro cofre)",
    withdrawalReasonLabel: "Motivo da sangria",
    recordWithdrawal: "Registrar sangria",
    noWithdrawals: "Nenhuma sangria registrada nesta sessão.",
    depositInvalidAmount: "valor do suprimento inválido",
    depositReasonRequired: "motivo do suprimento é obrigatório",
    depositHeading: "Suprimento",
    depositAmountPlaceholder: "Ex: 50,00",
    depositAmountLabel: "Valor do suprimento",
    depositReasonPlaceholder: "Motivo (ex: reposição de troco)",
    depositReasonLabel: "Motivo do suprimento",
    recordDeposit: "Registrar suprimento",
    noDeposits: "Nenhum suprimento registrado nesta sessão.",
    countedInvalidAmount: "valor contado inválido",
    closeSession: "Fechar sessão",
    closeSessionCountHeading: "Fechar sessão — conferência",
    calculatingExpected: "Calculando valor esperado...",
    expectedInDrawer: "Valor esperado na gaveta: ",
    countInstructions: ". Conte o dinheiro físico e informe o valor abaixo.",
    countedAmountPlaceholder: "Ex: 0,00",
    countedAmountLabel: "Valor contado fisicamente na gaveta",
    confirmClose: "Confirmar fechamento",
    cancel: "Cancelar",
    openingInvalidAmount: "valor de abertura inválido",
    cashSessionHeading: "Sessão de Caixa",
    loading: "Carregando...",
    sessionOpenSince: (openedAt: string, openingAmount: string) =>
      `Sessão aberta desde ${openedAt} — fundo de troco inicial de ${openingAmount}.`,
    closingHeading: "Fechamento",
    sessionClosedSummary: (counted: string, expected: string) => `Sessão fechada — contado ${counted}, esperado ${expected} — `,
    noOpenSession: "Nenhuma sessão de caixa aberta. Informe o valor inicial da gaveta (fundo de troco) pra abrir uma.",
    openingAmountPlaceholder: "Ex: 100,00",
    openingAmountLabel: "Valor de abertura (fundo de troco)",
    openSession: "Abrir sessão",
    genericError: "não foi possível completar a ação",
    closedSessionDates: (closedAt: string, openedAt: string, openingAmount: string) =>
      `Fechada em ${closedAt} — aberta em ${openedAt}, fundo de troco de ${openingAmount}.`,
    countedVsExpected: (counted: string) => `Contado: ${counted} — Esperado (recalculado agora): `,
    loadingLower: "carregando...",
    expectedMayHaveChanged: "o valor esperado pode ter mudado desde o fechamento",
    closedSessionsHeading: "Sessões encerradas",
    noClosedSessions: "Nenhuma sessão de caixa encerrada ainda.",
    tableOrder: (table: string) => `Comanda ${table}`,
    standaloneOrder: (number: string) => `Comanda avulsa #${number}`,
    pageTitle: (date: string) => `Resumo de Caixa — ${date}`,
    liveNotice: "Atualiza a cada consulta, em tempo real — não existe uma ação de fechar o caixa.",
    daySummaryHeading: "Resumo do dia",
    closedOrders: (count: number) => `Comandas fechadas: ${count}`,
    subtotal: "Subtotal",
    serviceCharge: "Taxa de serviço",
    totalSold: "Total vendido",
    byPaymentMethod: "Por forma de pagamento",
    cash: "Dinheiro",
    card: "Cartão",
    pix: "Pix",
    pendingOrdersHeading: (count: number) => `Comandas pendentes (${count})`,
    pendingNotice: "Comandas ainda abertas não entram no total fechado acima.",
    pending: "pendente",
    noPendingOrders: "Nenhuma comanda pendente.",
  },
  en: {
    noDifference: "no variance",
    surplus: (amount: string) => `over by ${amount}`,
    shortage: (amount: string) => `short by ${amount}`,
    withdrawalInvalidAmount: "invalid pay-out amount",
    withdrawalReasonRequired: "pay-out reason is required",
    withdrawalHeading: "Pay-out",
    withdrawalAmountPlaceholder: "e.g. 20.00",
    withdrawalAmountLabel: "Pay-out amount",
    withdrawalReasonPlaceholder: "Reason (e.g. moving excess cash to the safe)",
    withdrawalReasonLabel: "Pay-out reason",
    recordWithdrawal: "Record pay-out",
    noWithdrawals: "No pay-outs recorded in this session.",
    depositInvalidAmount: "invalid pay-in amount",
    depositReasonRequired: "pay-in reason is required",
    depositHeading: "Pay-in",
    depositAmountPlaceholder: "e.g. 50.00",
    depositAmountLabel: "Pay-in amount",
    depositReasonPlaceholder: "Reason (e.g. topping up change)",
    depositReasonLabel: "Pay-in reason",
    recordDeposit: "Record pay-in",
    noDeposits: "No pay-ins recorded in this session.",
    countedInvalidAmount: "invalid counted amount",
    closeSession: "Close register",
    closeSessionCountHeading: "Close register — count",
    calculatingExpected: "Calculating expected amount...",
    expectedInDrawer: "Expected in drawer: ",
    countInstructions: ". Count the cash in the drawer and enter the amount below.",
    countedAmountPlaceholder: "e.g. 0.00",
    countedAmountLabel: "Cash counted in the drawer",
    confirmClose: "Confirm close",
    cancel: "Cancel",
    openingInvalidAmount: "invalid opening amount",
    cashSessionHeading: "Cash Session",
    loading: "Loading...",
    sessionOpenSince: (openedAt: string, openingAmount: string) =>
      `Register open since ${openedAt} — opening float of ${openingAmount}.`,
    closingHeading: "Closing",
    sessionClosedSummary: (counted: string, expected: string) => `Register closed — counted ${counted}, expected ${expected} — `,
    noOpenSession: "No cash session open. Enter the starting drawer amount (opening float) to open one.",
    openingAmountPlaceholder: "e.g. 100.00",
    openingAmountLabel: "Opening amount (opening float)",
    openSession: "Open register",
    genericError: "couldn't complete the action",
    closedSessionDates: (closedAt: string, openedAt: string, openingAmount: string) =>
      `Closed ${closedAt} — opened ${openedAt}, opening float of ${openingAmount}.`,
    countedVsExpected: (counted: string) => `Counted: ${counted} — Expected (recalculated now): `,
    loadingLower: "loading...",
    expectedMayHaveChanged: "the expected amount may have changed since closing",
    closedSessionsHeading: "Closed sessions",
    noClosedSessions: "No closed cash sessions yet.",
    tableOrder: (table: string) => `${table} tab`,
    standaloneOrder: (number: string) => `Walk-in tab #${number}`,
    pageTitle: (date: string) => `Cash Register Summary — ${date}`,
    liveNotice: "Updates live on every refresh — there's no close-register action here.",
    daySummaryHeading: "Today's summary",
    closedOrders: (count: number) => `Closed tabs: ${count}`,
    subtotal: "Subtotal",
    serviceCharge: "Service charge",
    totalSold: "Total sales",
    byPaymentMethod: "By payment method",
    cash: "Cash",
    card: "Card",
    pix: "Pix",
    pendingOrdersHeading: (count: number) => `Pending tabs (${count})`,
    pendingNotice: "Tabs that are still open aren't included in the closed total above.",
    pending: "pending",
    noPendingOrders: "No pending tabs.",
  },
});

type CashRegisterMessages = (typeof messages)["pt"];

/**
 * Épico 1 (Sessão de Caixa), Story 1.4 — achado no code review, 2026-09-27:
 * mostrar `differenceCents` cru (ex: "-R$ 7,00") viola o próprio princípio de
 * "nunca uma confirmação cega" em ação financeira sensível — o operador
 * precisa ler "sobra"/"falta" na hora, não inferir o sinal do número.
 */
function formatDifference(cents: number, m: CashRegisterMessages): string {
  if (cents === 0) return m.noDifference;
  const amount = formatCentsToBRL(Math.abs(cents));
  return cents > 0 ? m.surplus(amount) : m.shortage(amount);
}

/**
 * Épico 1 (Sessão de Caixa), Story 1.2 — formulário inline de sangria (valor
 * + motivo), abaixo da linha "Sessão aberta desde..." (mesmo padrão de
 * formulário curto de `CashSessionSection` acima). Lista as sangrias já
 * registradas nesta sessão logo abaixo, mais recente primeiro.
 */
function WithdrawalForm({ withdrawals, onRecorded }: { withdrawals: CashMovementRecord[]; onRecorded: () => void }) {
  const m = useMessages(messages);
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const cents = parseReaisToCents(amountText);
    if (cents === null || cents <= 0) {
      setError(m.withdrawalInvalidAmount);
      return;
    }
    if (reason.trim().length === 0) {
      setError(m.withdrawalReasonRequired);
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await recordWithdrawal(cents, reason.trim());
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      // Achado no code review, 2026-09-26: mesmo fix já aplicado ao
      // handleOpen na Story 1.1 — atualiza em QUALQUER erro (não só sessão
      // fechada/mesclada desde o último render), por simplicidade; custo de
      // uma consulta extra é baixo e cobre qualquer caso de dessincronia.
      onRecorded();
      return;
    }
    setAmountText("");
    setReason("");
    onRecorded();
  }

  return (
    <div className="table-map-section">
      <h3 className="subsection-heading">{m.withdrawalHeading}</h3>
      <form onSubmit={handleSubmit} className="inline-form">
        <input
          value={amountText}
          onChange={(e) => {
            setAmountText(e.target.value.replace(/[^0-9,.]/g, ""));
            setError(null);
          }}
          disabled={submitting}
          inputMode="decimal"
          placeholder={m.withdrawalAmountPlaceholder}
          aria-label={m.withdrawalAmountLabel}
        />
        <input
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setError(null);
          }}
          disabled={submitting}
          placeholder={m.withdrawalReasonPlaceholder}
          aria-label={m.withdrawalReasonLabel}
        />
        <button type="submit" className="button-primary" disabled={submitting}>
          {m.recordWithdrawal}
        </button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}

      <ul className="catalog-list">
        {[...withdrawals]
          .sort((a, b) => b.recordedAt - a.recordedAt)
          .map((w) => (
            <li key={w.id}>
              {formatCentsToBRL(w.amountCents)} — {w.reason} ({formatDateTime(w.recordedAt)})
            </li>
          ))}
        {withdrawals.length === 0 && <li className="catalog-empty">{m.noWithdrawals}</li>}
      </ul>
    </div>
  );
}

/**
 * Épico 1 (Sessão de Caixa), Story 1.3 — cópia estrutural exata de
 * `WithdrawalForm` acima (suprimento é espelho de sangria: valor + motivo,
 * mesma validação, mesmo `onRecorded` chamado tanto no sucesso quanto no
 * erro). Lista `deposits` já registrados nesta sessão, mais recente primeiro.
 */
function DepositForm({ deposits, onRecorded }: { deposits: CashMovementRecord[]; onRecorded: () => void }) {
  const m = useMessages(messages);
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const cents = parseReaisToCents(amountText);
    if (cents === null || cents <= 0) {
      setError(m.depositInvalidAmount);
      return;
    }
    if (reason.trim().length === 0) {
      setError(m.depositReasonRequired);
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await recordDeposit(cents, reason.trim());
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      // Mesmo racional da 1.2 (WithdrawalForm acima): atualiza em QUALQUER
      // erro, não só sessão fechada/mesclada desde o último render.
      onRecorded();
      return;
    }
    setAmountText("");
    setReason("");
    onRecorded();
  }

  return (
    <div className="table-map-section">
      <h3 className="subsection-heading">{m.depositHeading}</h3>
      <form onSubmit={handleSubmit} className="inline-form">
        <input
          value={amountText}
          onChange={(e) => {
            setAmountText(e.target.value.replace(/[^0-9,.]/g, ""));
            setError(null);
          }}
          disabled={submitting}
          inputMode="decimal"
          placeholder={m.depositAmountPlaceholder}
          aria-label={m.depositAmountLabel}
        />
        <input
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setError(null);
          }}
          disabled={submitting}
          placeholder={m.depositReasonPlaceholder}
          aria-label={m.depositReasonLabel}
        />
        <button type="submit" className="button-primary" disabled={submitting}>
          {m.recordDeposit}
        </button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}

      <ul className="catalog-list">
        {[...deposits]
          .sort((a, b) => b.recordedAt - a.recordedAt)
          .map((d) => (
            <li key={d.id}>
              {formatCentsToBRL(d.amountCents)} — {d.reason} ({formatDateTime(d.recordedAt)})
            </li>
          ))}
        {deposits.length === 0 && <li className="catalog-empty">{m.noDeposits}</li>}
      </ul>
    </div>
  );
}

/**
 * Épico 1 (Sessão de Caixa), Story 1.4 — fechamento em duas etapas: 1)
 * "Fechar sessão" busca e mostra o valor esperado (preview, sem gravar
 * nada); 2) o operador informa o valor contado e confirma. A diferença
 * (contado − esperado) é sempre exibida, mesmo ≠ 0 — nunca bloqueia o
 * fechamento (UX & Interaction Patterns do epic-context: nunca uma
 * confirmação cega em ação financeira sensível).
 */
function CloseSessionFlow({ onClosed }: { onClosed: (result: { countedAmountCents: number; expectedAmountCents: number; differenceCents: number }) => void }) {
  const m = useMessages(messages);
  const [step, setStep] = useState<"idle" | "confirming">("idle");
  const [expectedAmountCents, setExpectedAmountCents] = useState<number | null>(null);
  const [countedText, setCountedText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Achado no code review (edge-case-hunter, 2026-09-27): `state` (`step`)
  // só é atualizado no próximo render, então um duplo-clique rápido no botão
  // "Fechar sessão" podia disparar `handleStart` duas vezes antes do botão
  // sumir da tela, cada chamada com sua própria requisição de preview. Uma
  // `ref` (síncrona, não espera render) bloqueia a segunda chamada.
  const startingRef = useRef(false);

  async function handleStart() {
    if (startingRef.current) return;
    startingRef.current = true;
    setStep("confirming");
    setError(null);
    setCountedText("");
    setExpectedAmountCents(null);
    setLoadingPreview(true);
    const result = await getExpectedAmount();
    setLoadingPreview(false);
    startingRef.current = false;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setExpectedAmountCents(result.data.expectedAmountCents);
  }

  function handleCancel() {
    setStep("idle");
    setError(null);
    setCountedText("");
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const cents = parseReaisToCents(countedText);
    // Diferente de abertura/sangria/suprimento (que exigem > 0): zero é um
    // valor contado válido (gaveta vazia é raro mas acontece).
    if (cents === null || cents < 0) {
      setError(m.countedInvalidAmount);
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await closeCashSession(cents);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setStep("idle");
    setCountedText("");
    onClosed(result.data);
  }

  if (step === "idle") {
    return (
      <button type="button" className="button-secondary" onClick={handleStart}>
        {m.closeSession}
      </button>
    );
  }

  return (
    <div className="table-map-section">
      <h3 className="subsection-heading">{m.closeSessionCountHeading}</h3>
      {loadingPreview ? (
        <p>{m.calculatingExpected}</p>
      ) : expectedAmountCents !== null ? (
        <p>
          {m.expectedInDrawer}
          <strong>{formatCentsToBRL(expectedAmountCents)}</strong>
          {m.countInstructions}
        </p>
      ) : null}
      <form onSubmit={handleConfirm} className="inline-form">
        <input
          value={countedText}
          onChange={(e) => {
            setCountedText(e.target.value.replace(/[^0-9,.]/g, ""));
            setError(null);
          }}
          disabled={submitting || loadingPreview}
          inputMode="decimal"
          placeholder={m.countedAmountPlaceholder}
          aria-label={m.countedAmountLabel}
        />
        <button type="submit" className="button-primary" disabled={submitting || loadingPreview}>
          {m.confirmClose}
        </button>
        <button type="button" className="button-secondary" onClick={handleCancel} disabled={submitting}>
          {m.cancel}
        </button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

/**
 * Épico 1 (Sessão de Caixa), Story 1.1 — abertura de sessão. Decisão
 * confirmada com o dono, 2026-09-25 (ver `spec-1-1-abrir-sessão-de-caixa.md`):
 * vive DENTRO desta tela existente, como bloco novo no topo — não é rota
 * nova nem item de nav novo, e não substitui o resumo do dia abaixo (Épico
 * 6, `useCashRegisterSummary`), que continua sendo um relatório somativo
 * recalculado a cada consulta, sem nenhuma ação de fechamento.
 *
 * Achado no code review, 2026-09-26 (Story 1.4): `status`/`openSession`/
 * `refresh` vêm de PROPS agora, não de uma chamada própria a
 * `useCashSessionState()` — esse hook guarda estado local (`useState`), sem
 * cache/contexto compartilhado; duas chamadas independentes (uma aqui, outra
 * em `CashRegister`) nunca se sincronizam entre si. Fechar uma sessão
 * atualizava só a cópia local desta seção — a lista "Sessões encerradas"
 * (alimentada pela chamada separada em `CashRegister`) nunca via a sessão
 * recém-fechada até um reload completo da página. Corrigido chamando o hook
 * uma ÚNICA vez em `CashRegister` e passando tudo por props pras duas
 * seções que precisam do mesmo estado.
 */
function CashSessionSection({
  status,
  openSession,
  refresh,
}: {
  status: "loading" | "ready";
  openSession: CashSessionState | undefined;
  refresh: () => void;
}) {
  const m = useMessages(messages);
  const [amountText, setAmountText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [closeResult, setCloseResult] = useState<{ countedAmountCents: number; expectedAmountCents: number; differenceCents: number } | null>(null);

  async function handleOpen(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const cents = parseReaisToCents(amountText);
    if (cents === null || cents <= 0) {
      setError(m.openingInvalidAmount);
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
    setCloseResult(null);
    refresh();
  }

  function handleClosed(result: { countedAmountCents: number; expectedAmountCents: number; differenceCents: number }) {
    setCloseResult(result);
    refresh();
  }

  return (
    <div className="table-map-section">
      <h2 className="section-heading">{m.cashSessionHeading}</h2>
      {status === "loading" ? (
        <p>{m.loading}</p>
      ) : openSession ? (
        <>
          <p>{m.sessionOpenSince(formatDateTime(openSession.openedAt), formatCentsToBRL(openSession.openingAmountCents))}</p>
          {/* Achado no code review, 2026-09-26: `?? []` defende contra um
              sidecar rodando ainda de uma versão anterior a esta story (não
              reinicia sozinho — mesmo racional já documentado em
              `useTablesAndOrders.refresh`), cujo `/state` pode devolver a
              sessão sem o campo `withdrawals`/`deposits` apesar do tipo dizer obrigatório. */}
          <WithdrawalForm withdrawals={openSession.withdrawals ?? []} onRecorded={refresh} />
          <DepositForm deposits={openSession.deposits ?? []} onRecorded={refresh} />
          <div className="table-map-section">
            <h3 className="subsection-heading">{m.closingHeading}</h3>
            <CloseSessionFlow onClosed={handleClosed} />
          </div>
        </>
      ) : (
        <>
          {closeResult && (
            <p>
              {m.sessionClosedSummary(formatCentsToBRL(closeResult.countedAmountCents), formatCentsToBRL(closeResult.expectedAmountCents))}
              <strong>{formatDifference(closeResult.differenceCents, m)}</strong>.
            </p>
          )}
          <p>{m.noOpenSession}</p>
          <form onSubmit={handleOpen} className="inline-form">
            <input
              value={amountText}
              onChange={(e) => {
                setAmountText(e.target.value.replace(/[^0-9,.]/g, ""));
                setError(null);
              }}
              disabled={submitting}
              inputMode="decimal"
              placeholder={m.openingAmountPlaceholder}
              aria-label={m.openingAmountLabel}
            />
            <button type="submit" className="button-primary" disabled={submitting}>
              {m.openSession}
            </button>
          </form>
          {error && <p className="form-error" role="alert">{error}</p>}
        </>
      )}
    </div>
  );
}

/**
 * Épico 1 (Sessão de Caixa), Story 1.4 — uma sessão já fechada na lista de
 * histórico. O valor esperado é SEMPRE recalculado na hora da leitura
 * (`GET /cash-sessions/expected?sessionId=`, nunca um valor congelado do
 * momento do fechamento) — por isso aparece com um aviso visível de que
 * pode ter mudado desde o fechamento (decisão já tomada na Story 1.1,
 * UX-DR5: não é um "antes/depois" comparado, é sempre o valor atual + aviso
 * estático).
 */
function ClosedSessionCard({ session }: { session: CashSessionState }) {
  const m = useMessages(messages);
  const [expectedAmountCents, setExpectedAmountCents] = useState<number | null>(null);
  // Achado no code review (blind-hunter + edge-case-hunter, 2026-09-27): o
  // `.then` original só tratava `result.ok === true` — um erro de resposta
  // (`result.ok === false`) ou a própria Promise rejeitando (rede fora) nunca
  // eram tratados, deixando o card preso em "carregando..." pra sempre, sem
  // nenhuma indicação de erro (diferente de `CloseSessionFlow`, que já trata
  // `!result.ok` pro mesmo `getExpectedAmount`).
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getExpectedAmount(session.id)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setExpectedAmountCents(result.data.expectedAmountCents);
        } else {
          setError(result.error);
        }
      })
      .catch(() => {
        if (!cancelled) setError(m.genericError);
      });
    return () => {
      cancelled = true;
    };
  }, [session.id]);

  const closing = session.closing;
  if (!closing) return null;
  const differenceCents = expectedAmountCents === null ? null : closing.countedAmountCents - expectedAmountCents;

  return (
    <li>
      <p>
        {m.closedSessionDates(formatDateTime(closing.closedAt), formatDateTime(session.openedAt), formatCentsToBRL(session.openingAmountCents))}
      </p>
      <p>
        {m.countedVsExpected(formatCentsToBRL(closing.countedAmountCents))}
        {expectedAmountCents === null ? (error ?? m.loadingLower) : formatCentsToBRL(expectedAmountCents)}
        {differenceCents !== null && <> — {formatDifference(differenceCents, m)}</>}
      </p>
      <span className="status-badge status-badge-warning">
        {m.expectedMayHaveChanged}
      </span>
    </li>
  );
}

/** Épico 1 (Sessão de Caixa), Story 1.4 — histórico de sessões já fechadas. */
function ClosedSessionsSection({ cashSessions }: { cashSessions: CashSessionState[] }) {
  const m = useMessages(messages);
  const closedSessions = [...cashSessions]
    .filter((s) => s.mergedInto === undefined && s.status === "closed" && s.closing)
    .sort((a, b) => (b.closing?.closedAt ?? 0) - (a.closing?.closedAt ?? 0));

  return (
    <div className="table-map-section">
      <h2 className="section-heading">{m.closedSessionsHeading}</h2>
      <ul className="catalog-list">
        {closedSessions.map((s) => (
          <ClosedSessionCard key={s.id} session={s} />
        ))}
        {closedSessions.length === 0 && <li className="catalog-empty">{m.noClosedSessions}</li>}
      </ul>
    </div>
  );
}

/** PRD Épico 6.1 (M8) — resumo do dia, calculado só da réplica local. Renomeado de "Fechamento de Caixa" (emenda 2026-09-22): é um relatório ao vivo, nunca houve ação de fechamento. */
function CashRegister() {
  const m = useMessages(messages);
  const { status, summary } = useCashRegisterSummary();
  const { tables } = useTablesAndOrders();
  const { status: cashSessionStatus, openSession, cashSessions, refresh: refreshCashSessions } = useCashSessionState();

  if (status === "loading" || !summary) {
    return (
      <section>
        <p>{m.loading}</p>
      </section>
    );
  }

  const orderLabel = (order: {
    origin: { source: "table" | "standalone"; number?: number };
    currentTableId?: string;
  }) =>
    order.origin.source === "table"
      ? m.tableOrder(tables.find((t) => t.id === order.currentTableId)?.identifier ?? "?")
      : m.standaloneOrder(String(order.origin.number));

  return (
    <section>
      <h1>{m.pageTitle(summary.date)}</h1>

      <CashSessionSection status={cashSessionStatus} openSession={openSession} refresh={refreshCashSessions} />

      <ClosedSessionsSection cashSessions={cashSessions} />

      {/* Achado na validação de UX, 2026-09-23: .type-label (rótulo 13px)
          usado em parágrafo explicativo em vez de texto corrido — mais
          difícil de ler rápido, justo onde o dono precisa disso. */}
      <p>{m.liveNotice}</p>

      <div className="table-map-section">
        <h2 className="section-heading">{m.daySummaryHeading}</h2>
        <p>{m.closedOrders(summary.closedOrdersCount)}</p>
        <div className="summary">
          <div className="summary-row">
            <span className="type-label">{m.subtotal}</span>
            <span className="amount">
              {formatCentsToBRL(summary.subtotalCents)}
            </span>
          </div>
          <div className="summary-row">
            <span className="type-label">{m.serviceCharge}</span>
            <span className="amount">
              {formatCentsToBRL(summary.serviceFeeCents)}
            </span>
          </div>
          <div className="summary-row summary-row-total">
            <span className="type-label">{m.totalSold}</span>
            <span className="amount amount-display">
              {formatCentsToBRL(summary.totalSoldCents)}
            </span>
          </div>
        </div>

        <h3 className="subsection-heading">{m.byPaymentMethod}</h3>
        <div className="summary">
          <div className="summary-row">
            <span className="type-label">{m.cash}</span>
            <span className="amount">
              {formatCentsToBRL(summary.totalByPaymentMethod.cash)}
            </span>
          </div>
          <div className="summary-row">
            <span className="type-label">{m.card}</span>
            <span className="amount">
              {formatCentsToBRL(summary.totalByPaymentMethod.card)}
            </span>
          </div>
          <div className="summary-row">
            <span className="type-label">{m.pix}</span>
            <span className="amount">
              {formatCentsToBRL(summary.totalByPaymentMethod.pix)}
            </span>
          </div>
        </div>
      </div>

      <div className="table-map-section">
        <h2 className="section-heading">{m.pendingOrdersHeading(summary.pendingOrders.length)}</h2>
        <p>{m.pendingNotice}</p>
        <ul className="catalog-list">
          {summary.pendingOrders.map((o) => (
            <li key={o.id}>
              <a href={`#/orders/${o.id}`}>{orderLabel(o)}</a>
              <span className="status-badge status-badge-warning">
                {m.pending}
              </span>
            </li>
          ))}
          {summary.pendingOrders.length === 0 && (
            <li className="catalog-empty">{m.noPendingOrders}</li>
          )}
        </ul>
      </div>
    </section>
  );
}

export default CashRegister;

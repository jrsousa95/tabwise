import { useEffect, useState } from "react";
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

/**
 * Épico 1 (Sessão de Caixa), Story 1.4 — achado no code review, 2026-09-27:
 * mostrar `differenceCents` cru (ex: "-R$ 7,00") viola o próprio princípio de
 * "nunca uma confirmação cega" em ação financeira sensível — o operador
 * precisa ler "sobra"/"falta" na hora, não inferir o sinal do número.
 */
function formatDifference(cents: number): string {
  if (cents === 0) return "sem diferença";
  const label = cents > 0 ? "sobra" : "falta";
  return `${label} de ${formatCentsToBRL(Math.abs(cents))}`;
}

/**
 * Épico 1 (Sessão de Caixa), Story 1.2 — formulário inline de sangria (valor
 * + motivo), abaixo da linha "Sessão aberta desde..." (mesmo padrão de
 * formulário curto de `CashSessionSection` acima). Lista as sangrias já
 * registradas nesta sessão logo abaixo, mais recente primeiro.
 */
function WithdrawalForm({ withdrawals, onRecorded }: { withdrawals: CashMovementRecord[]; onRecorded: () => void }) {
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const cents = parseReaisToCents(amountText);
    if (cents === null || cents <= 0) {
      setError("valor da sangria inválido");
      return;
    }
    if (reason.trim().length === 0) {
      setError("motivo da sangria é obrigatório");
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
      <h3 className="subsection-heading">Sangria</h3>
      <form onSubmit={handleSubmit} className="inline-form">
        <input
          value={amountText}
          onChange={(e) => {
            setAmountText(e.target.value.replace(/[^0-9,.]/g, ""));
            setError(null);
          }}
          disabled={submitting}
          inputMode="decimal"
          placeholder="Ex: 20,00"
          aria-label="Valor da sangria"
        />
        <input
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setError(null);
          }}
          disabled={submitting}
          placeholder="Motivo (ex: reforço de troco pro cofre)"
          aria-label="Motivo da sangria"
        />
        <button type="submit" className="button-primary" disabled={submitting}>
          Registrar sangria
        </button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}

      <ul className="catalog-list">
        {[...withdrawals]
          .sort((a, b) => b.recordedAt - a.recordedAt)
          .map((w) => (
            <li key={w.id}>
              {formatCentsToBRL(w.amountCents)} — {w.reason} ({new Date(w.recordedAt).toLocaleString("pt-BR")})
            </li>
          ))}
        {withdrawals.length === 0 && <li className="catalog-empty">Nenhuma sangria registrada nesta sessão.</li>}
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
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const cents = parseReaisToCents(amountText);
    if (cents === null || cents <= 0) {
      setError("valor do suprimento inválido");
      return;
    }
    if (reason.trim().length === 0) {
      setError("motivo do suprimento é obrigatório");
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
      <h3 className="subsection-heading">Suprimento</h3>
      <form onSubmit={handleSubmit} className="inline-form">
        <input
          value={amountText}
          onChange={(e) => {
            setAmountText(e.target.value.replace(/[^0-9,.]/g, ""));
            setError(null);
          }}
          disabled={submitting}
          inputMode="decimal"
          placeholder="Ex: 50,00"
          aria-label="Valor do suprimento"
        />
        <input
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setError(null);
          }}
          disabled={submitting}
          placeholder="Motivo (ex: reposição de troco)"
          aria-label="Motivo do suprimento"
        />
        <button type="submit" className="button-primary" disabled={submitting}>
          Registrar suprimento
        </button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}

      <ul className="catalog-list">
        {[...deposits]
          .sort((a, b) => b.recordedAt - a.recordedAt)
          .map((d) => (
            <li key={d.id}>
              {formatCentsToBRL(d.amountCents)} — {d.reason} ({new Date(d.recordedAt).toLocaleString("pt-BR")})
            </li>
          ))}
        {deposits.length === 0 && <li className="catalog-empty">Nenhum suprimento registrado nesta sessão.</li>}
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
  const [step, setStep] = useState<"idle" | "confirming">("idle");
  const [expectedAmountCents, setExpectedAmountCents] = useState<number | null>(null);
  const [countedText, setCountedText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleStart() {
    setStep("confirming");
    setError(null);
    setCountedText("");
    setExpectedAmountCents(null);
    setLoadingPreview(true);
    const result = await getExpectedAmount();
    setLoadingPreview(false);
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
      setError("valor contado inválido");
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
        Fechar sessão
      </button>
    );
  }

  return (
    <div className="table-map-section">
      <h3 className="subsection-heading">Fechar sessão — conferência</h3>
      {loadingPreview ? (
        <p>Calculando valor esperado...</p>
      ) : expectedAmountCents !== null ? (
        <p>
          Valor esperado na gaveta: <strong>{formatCentsToBRL(expectedAmountCents)}</strong>. Conte o dinheiro
          físico e informe o valor abaixo.
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
          placeholder="Ex: 0,00"
          aria-label="Valor contado fisicamente na gaveta"
        />
        <button type="submit" className="button-primary" disabled={submitting || loadingPreview}>
          Confirmar fechamento
        </button>
        <button type="button" className="button-secondary" onClick={handleCancel} disabled={submitting}>
          Cancelar
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
  const [amountText, setAmountText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [closeResult, setCloseResult] = useState<{ countedAmountCents: number; expectedAmountCents: number; differenceCents: number } | null>(null);

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
    setCloseResult(null);
    refresh();
  }

  function handleClosed(result: { countedAmountCents: number; expectedAmountCents: number; differenceCents: number }) {
    setCloseResult(result);
    refresh();
  }

  return (
    <div className="table-map-section">
      <h2 className="section-heading">Sessão de Caixa</h2>
      {status === "loading" ? (
        <p>Carregando...</p>
      ) : openSession ? (
        <>
          <p>
            Sessão aberta desde{" "}
            {new Date(openSession.openedAt).toLocaleString("pt-BR")} — fundo de
            troco inicial de {formatCentsToBRL(openSession.openingAmountCents)}.
          </p>
          {/* Achado no code review, 2026-09-26: `?? []` defende contra um
              sidecar rodando ainda de uma versão anterior a esta story (não
              reinicia sozinho — mesmo racional já documentado em
              `useTablesAndOrders.refresh`), cujo `/state` pode devolver a
              sessão sem o campo `withdrawals`/`deposits` apesar do tipo dizer obrigatório. */}
          <WithdrawalForm withdrawals={openSession.withdrawals ?? []} onRecorded={refresh} />
          <DepositForm deposits={openSession.deposits ?? []} onRecorded={refresh} />
          <div className="table-map-section">
            <h3 className="subsection-heading">Fechamento</h3>
            <CloseSessionFlow onClosed={handleClosed} />
          </div>
        </>
      ) : (
        <>
          {closeResult && (
            <p>
              Sessão fechada — contado {formatCentsToBRL(closeResult.countedAmountCents)}, esperado{" "}
              {formatCentsToBRL(closeResult.expectedAmountCents)} —{" "}
              <strong>{formatDifference(closeResult.differenceCents)}</strong>.
            </p>
          )}
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
  const [expectedAmountCents, setExpectedAmountCents] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getExpectedAmount(session.id).then((result) => {
      if (!cancelled && result.ok) setExpectedAmountCents(result.data.expectedAmountCents);
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
        Fechada em {new Date(closing.closedAt).toLocaleString("pt-BR")} — aberta em{" "}
        {new Date(session.openedAt).toLocaleString("pt-BR")}, fundo de troco de{" "}
        {formatCentsToBRL(session.openingAmountCents)}.
      </p>
      <p>
        Contado: {formatCentsToBRL(closing.countedAmountCents)} — Esperado (recalculado agora):{" "}
        {expectedAmountCents === null ? "carregando..." : formatCentsToBRL(expectedAmountCents)}
        {differenceCents !== null && <> — {formatDifference(differenceCents)}</>}
      </p>
      <span className="status-badge status-badge-warning">
        o valor esperado pode ter mudado desde o fechamento
      </span>
    </li>
  );
}

/** Épico 1 (Sessão de Caixa), Story 1.4 — histórico de sessões já fechadas. */
function ClosedSessionsSection({ cashSessions }: { cashSessions: CashSessionState[] }) {
  const closedSessions = [...cashSessions]
    .filter((s) => s.mergedInto === undefined && s.status === "closed" && s.closing)
    .sort((a, b) => (b.closing?.closedAt ?? 0) - (a.closing?.closedAt ?? 0));

  return (
    <div className="table-map-section">
      <h2 className="section-heading">Sessões encerradas</h2>
      <ul className="catalog-list">
        {closedSessions.map((s) => (
          <ClosedSessionCard key={s.id} session={s} />
        ))}
        {closedSessions.length === 0 && <li className="catalog-empty">Nenhuma sessão de caixa encerrada ainda.</li>}
      </ul>
    </div>
  );
}

/** PRD Épico 6.1 (M8) — resumo do dia, calculado só da réplica local. Renomeado de "Fechamento de Caixa" (emenda 2026-09-22): é um relatório ao vivo, nunca houve ação de fechamento. */
function CashRegister() {
  const { status, summary } = useCashRegisterSummary();
  const { tables } = useTablesAndOrders();
  const { status: cashSessionStatus, openSession, cashSessions, refresh: refreshCashSessions } = useCashSessionState();

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

      <CashSessionSection status={cashSessionStatus} openSession={openSession} refresh={refreshCashSessions} />

      <ClosedSessionsSection cashSessions={cashSessions} />

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

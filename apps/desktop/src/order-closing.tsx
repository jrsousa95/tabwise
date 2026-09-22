import { useEffect, useState } from "react";
import { formatCentsToBRL, parseReaisToCents } from "./lib/money";
import { useEstablishment, closeOrder, type Split } from "./lib/closing";

/* Ícone inline (SVG, stroke=currentColor, sem preenchimento, 20×20) — mesmo
   padrão já usado em catalog.tsx/table-map.tsx pra ações de linha
   compactas (achado em uso real, 2026-09-22: "Remover" aqui era texto
   completo, diferente do "Remover" usado nessas outras telas). */
function TrashIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

type SplitRow = { id: string; amountText: string; paymentMethod: "cash" | "card" | "pix"; cashReceivedText: string };

function newSplitRow(amountCents?: number): SplitRow {
  return {
    id: Math.random().toString(36).slice(2),
    amountText: amountCents !== undefined ? (amountCents / 100).toFixed(2).replace(".", ",") : "",
    paymentMethod: "card",
    cashReceivedText: "",
  };
}

/** PRD 5.2 — resto da divisão inteira vai pra primeira parcela, mesmo princípio usado no sidecar. */
function distributeEquallyCents(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const result = new Array(parts).fill(base) as number[];
  result[0] += total - base * parts;
  return result;
}

/**
 * PRD Épico 5/M7 — resumo da comanda antes de fechar, taxa de serviço
 * ajustável, split (igual ou manual) e fechamento. Fechamento é sempre
 * individual (PRD 2.6 removido em 2026-09-22).
 */
function OrderClosing({
  orderId,
  subtotalCents,
  onClosed,
}: {
  orderId: string;
  subtotalCents: number;
  onClosed: () => void;
}) {
  const { status: establishmentStatus, defaultServiceFeePercent } = useEstablishment();
  const [serviceFeePercent, setServiceFeePercent] = useState<string | null>(null);
  const [splits, setSplits] = useState<SplitRow[]>([]);
  const [equalParts, setEqualParts] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const percentText = serviceFeePercent ?? String(defaultServiceFeePercent);
  const percent = Number(percentText.replace(",", "."));
  const percentValid = Number.isFinite(percent) && percent >= 0;
  const serviceFeeCents = percentValid ? Math.round((subtotalCents * percent) / 100) : 0;
  const totalCents = subtotalCents + serviceFeeCents;

  // Achado em uso real, 2026-09-22: dividir a conta era obrigatório pra
  // conseguir fechar — mesmo o caso comum (1 pagamento, sem divisão) exigia
  // clicar "Dividir igualmente" antes. Agora existe sempre uma parte única
  // (o total inteiro) por padrão, sincronizada automaticamente enquanto for
  // a única — "Dividir a conta" vira opcional, só pra quando o cliente
  // realmente divide entre 2+ pagamentos. Precisa vir antes do "return null"
  // de loading (hooks não podem ser condicionais — Rules of Hooks).
  useEffect(() => {
    if (establishmentStatus !== "ready") return;
    setSplits((prev) => {
      if (prev.length === 0) return [newSplitRow(totalCents)];
      if (prev.length === 1) return [{ ...prev[0], amountText: (totalCents / 100).toFixed(2).replace(".", ",") }];
      return prev;
    });
  }, [establishmentStatus, totalCents]);

  if (establishmentStatus === "loading") return null;

  const parsedSplits = splits.map((s) => ({ row: s, amountCents: parseReaisToCents(s.amountText) }));
  const splitSumCents = parsedSplits.reduce((sum, s) => sum + (s.amountCents ?? 0), 0);
  const allSplitsValid = parsedSplits.every((s) => s.amountCents !== null && s.amountCents > 0);
  const diffCents = totalCents - splitSumCents;
  const canConfirm = percentValid && splits.length > 0 && allSplitsValid && diffCents === 0 && !submitting;

  function handleGenerateEqual() {
    const parts = Number(equalParts);
    if (!Number.isInteger(parts) || parts <= 0) return;
    setSplits(distributeEquallyCents(totalCents, parts).map((cents) => newSplitRow(cents)));
    setError(null);
  }

  function updateSplit(id: string, patch: Partial<SplitRow>) {
    setSplits((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function removeSplit(id: string) {
    setSplits((prev) => prev.filter((s) => s.id !== id));
  }

  async function handleConfirm() {
    if (!canConfirm) return;
    setSubmitting(true);
    setError(null);

    const payloadSplits: Split[] = splits.map((s) => {
      const amountCents = parseReaisToCents(s.amountText)!;
      const cashReceivedCents = s.paymentMethod === "cash" ? (parseReaisToCents(s.cashReceivedText) ?? amountCents) : undefined;
      return { amountCents, paymentMethod: s.paymentMethod, cashReceivedCents };
    });

    const result = await closeOrder(orderId, { serviceFeePercent: percent, splits: payloadSplits });

    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onClosed();
  }

  return (
    <div className="table-map-section">
      <h3>Fechar comanda</h3>

      <label>
        Taxa de serviço (%)
        <input value={percentText} onChange={(e) => setServiceFeePercent(e.target.value.replace(/[^0-9,.]/g, ""))} inputMode="decimal" />
      </label>

      <div className="summary">
        <div className="summary-row">
          <span className="type-label">Subtotal</span>
          <span className="amount">{formatCentsToBRL(subtotalCents)}</span>
        </div>
        <div className="summary-row">
          <span className="type-label">Taxa de serviço</span>
          <span className="amount">{formatCentsToBRL(serviceFeeCents)}</span>
        </div>
        <div className="summary-row summary-row-total">
          <span className="type-label">Total</span>
          <span className="amount amount-display">{formatCentsToBRL(totalCents)}</span>
        </div>
      </div>

      <h4>Dividir a conta (opcional)</h4>
      <p className="type-label">Por padrão é 1 pagamento só, o valor total. Divida só se precisar.</p>
      <div className="inline-form">
        <input value={equalParts} onChange={(e) => setEqualParts(e.target.value.replace(/\D/g, ""))} inputMode="numeric" aria-label="Número de partes" />
        <button type="button" className="button-secondary" onClick={handleGenerateEqual}>
          Dividir igualmente
        </button>
        <button type="button" className="button-secondary" onClick={() => setSplits((prev) => [...prev, newSplitRow()])}>
          Adicionar parte manual
        </button>
      </div>

      {splits.map((s) => (
        <div key={s.id} className="split-row">
          <input
            className="amount"
            value={s.amountText}
            onChange={(e) => updateSplit(s.id, { amountText: e.target.value.replace(/[^0-9,.]/g, "") })}
            placeholder="Valor (R$)"
            inputMode="decimal"
          />
          <select value={s.paymentMethod} onChange={(e) => updateSplit(s.id, { paymentMethod: e.target.value as "cash" | "card" | "pix" })}>
            <option value="card">Cartão</option>
            <option value="pix">Pix</option>
            <option value="cash">Dinheiro</option>
          </select>
          {s.paymentMethod === "cash" && (
            <input
              className="amount"
              value={s.cashReceivedText}
              onChange={(e) => updateSplit(s.id, { cashReceivedText: e.target.value.replace(/[^0-9,.]/g, "") })}
              placeholder="Valor recebido (R$)"
              inputMode="decimal"
            />
          )}
          <button
            type="button"
            className="button-secondary row-action-button"
            onClick={() => removeSplit(s.id)}
            aria-label="Remover parte do split"
            title="Remover"
          >
            <TrashIcon />
          </button>
        </div>
      ))}

      {/* Com 1 parte só (padrão, sem divisão) o valor já está sempre em dia —
          o aviso de falta/sobra só é informativo quando existe divisão de
          verdade (2+ partes). */}
      {splits.length > 1 && (
        <p className={`split-diff ${diffCents === 0 ? "split-diff-ok" : diffCents > 0 ? "split-diff-danger" : "split-diff-warning"}`}>
          {diffCents === 0 ? "Split bate certinho." : diffCents > 0 ? `Falta ${formatCentsToBRL(diffCents)}.` : `Sobra ${formatCentsToBRL(-diffCents)}.`}
        </p>
      )}

      {error && <p className="form-error">{error}</p>}

      <button type="button" className="button-primary" onClick={handleConfirm} disabled={!canConfirm}>
        Confirmar fechamento
      </button>
    </div>
  );
}

export default OrderClosing;

import { useState } from "react";
import { formatCentsToBRL, parseReaisToCents } from "./lib/money";
import { useEstablishment, closeOrder, type Split } from "./lib/closing";

type SplitRow = { id: string; amountText: string; paymentMethod: "cash" | "card"; cashReceivedText: string };

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

  if (establishmentStatus === "loading") return null;

  const percentText = serviceFeePercent ?? String(defaultServiceFeePercent);
  const percent = Number(percentText.replace(",", "."));
  const percentValid = Number.isFinite(percent) && percent >= 0;
  const serviceFeeCents = percentValid ? Math.round((subtotalCents * percent) / 100) : 0;
  const totalCents = subtotalCents + serviceFeeCents;

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

      <h4>Dividir a conta</h4>
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
          <select value={s.paymentMethod} onChange={(e) => updateSplit(s.id, { paymentMethod: e.target.value as "cash" | "card" })}>
            <option value="card">Cartão</option>
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
          <button type="button" className="button-secondary" onClick={() => removeSplit(s.id)}>
            Remover
          </button>
        </div>
      ))}

      {splits.length > 0 && (
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

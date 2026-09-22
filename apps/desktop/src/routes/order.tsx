import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSession } from "../lib/session";
import { useOrder, addItemToOrder, cancelItem, updateItemNote, incrementItemQuantity } from "../lib/order";
import { useTablesAndOrders } from "../lib/tables";
import { formatCentsToBRL } from "../lib/money";
import { cancelReasonLabel, cancelReasons, type CancelReason } from "../lib/cancel-reason";
import type { Product } from "../lib/catalog";
import ProductSearch from "../product-search";
import OrderClosing from "../order-closing";

/* Ícone inline (SVG, stroke=currentColor, sem preenchimento, 20×20) — mesmo
   padrão já usado em catalog.tsx/table-map.tsx pra ações de linha
   compactas (achado em uso real, 2026-09-22: "Cancelar" aqui era texto
   completo numa `.catalog-table`, diferente das outras ações de linha de
   tabela do app). X em vez de lixeira: cancelar item não apaga o histórico
   (evento append-only), só marca como cancelado — "remover" seria a
   metáfora errada. */
function CancelIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/** PRD Épico 4/5 (M6/M7) — lançamento/cancelamento de itens e fechamento de comanda. */
function Order() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { operator } = useSession();
  const { status, order, refresh } = useOrder(orderId);
  const { tables } = useTablesAndOrders();

  const [closing, setClosing] = useState(false);

  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [cancelingItemId, setCancelingItemId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState<CancelReason>("entry_error");
  const [cancelNote, setCancelNote] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);

  const [editingNoteItemId, setEditingNoteItemId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteSubmitting, setNoteSubmitting] = useState(false);

  // PRD §2 — garçom lança item mas não cancela nem fecha comanda; só caixa/dono.
  const canManageOrder = operator?.role === "owner" || operator?.role === "cashier";

  if (status === "loading") {
    return (
      <section>
        <p>Carregando...</p>
      </section>
    );
  }

  if (status === "not-found" || !order || !orderId) {
    return (
      <section>
        <p>Comanda não encontrada.</p>
      </section>
    );
  }

  const tableLabel = order.currentTableId ? tables.find((t) => t.id === order.currentTableId)?.identifier : undefined;
  const title = order.origin.source === "table" ? `Comanda — ${tableLabel ?? "mesa"}` : `Comanda avulsa #${order.origin.number}`;
  const subtotalCents = order.items.filter((i) => !i.canceled).reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);

  function handleSelectProduct(product: Product) {
    setPendingProduct(product);
    setQuantity("1");
    setNote("");
    setAddError(null);
  }

  async function handleConfirmAdd() {
    if (!pendingProduct || !orderId) return;
    const quantityValue = Number(quantity);
    if (!Number.isInteger(quantityValue) || quantityValue <= 0) {
      setAddError("quantidade precisa ser um número inteiro positivo");
      return;
    }
    setAdding(true);
    setAddError(null);
    const result = await addItemToOrder(orderId, {
      productId: pendingProduct.id,
      quantity: quantityValue,
      note: note.trim() || undefined,
    });
    setAdding(false);
    if (!result.ok) {
      setAddError(result.error);
      return;
    }
    setPendingProduct(null);
    refresh();
  }

  // Achado em uso real, 2026-09-22: escolher produto sempre abria o formulário
  // de quantidade/observação, mesmo pro caso comum de só lançar 1 unidade sem
  // nota — clique único adiciona 1 direto; quantidade/observação continuam
  // disponíveis via handleSelectProduct (botão secundário na busca).
  //
  // Segundo achado, mesmo dia: a primeira versão sempre criava um item_added
  // novo, então clicar "+" repetido no mesmo produto virava várias linhas
  // duplicadas em vez de uma linha só com a quantidade somada. Agora, se já
  // existe uma linha aberta (não cancelada) do mesmo produto (nome + preço —
  // o item não guarda productId, é denormalizado de propósito, ver
  // shared-types/events.ts), incrementa ela em vez de criar outra.
  async function handleQuickAdd(product: Product) {
    if (!orderId) return;
    setAddError(null);
    const existing = order?.items.find((i) => !i.canceled && i.name === product.name && i.unitPriceCents === product.priceCents);
    const result = existing
      ? await incrementItemQuantity(orderId, existing.id)
      : await addItemToOrder(orderId, { productId: product.id, quantity: 1 });
    if (!result.ok) {
      setAddError(result.error);
      return;
    }
    refresh();
  }

  function handleStartEditNote(item: { id: string; note?: string }) {
    setEditingNoteItemId(item.id);
    setNoteDraft(item.note ?? "");
    setNoteError(null);
  }

  // Achado em uso real, 2026-09-22: única forma de corrigir a observação de
  // um item era cancelar e relançar — agora dá pra editar direto.
  async function handleConfirmEditNote() {
    if (!editingNoteItemId || !orderId) return;
    setNoteSubmitting(true);
    setNoteError(null);
    const result = await updateItemNote(orderId, editingNoteItemId, noteDraft.trim() || undefined);
    setNoteSubmitting(false);
    if (!result.ok) {
      setNoteError(result.error);
      return;
    }
    setEditingNoteItemId(null);
    refresh();
  }

  async function handleConfirmCancel(itemId: string) {
    if (!orderId) return;
    if (cancelReason === "other" && !cancelNote.trim()) {
      setCancelError("motivo 'outro' exige uma observação");
      return;
    }
    setCancelError(null);
    const result = await cancelItem(orderId, itemId, { reason: cancelReason, note: cancelNote.trim() || undefined });
    if (!result.ok) {
      setCancelError(result.error);
      return;
    }
    setCancelingItemId(null);
    setCancelNote("");
    setCancelReason("entry_error");
    refresh();
  }

  return (
    <section>
      <h2>{title}</h2>
      {order.status === "closed" && <p className="form-error">Comanda fechada — não aceita mais alterações.</p>}

      <table className="catalog-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Qtd</th>
            <th>Preço un.</th>
            <th>Subtotal</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item.id} className={item.canceled ? "catalog-row-inactive" : undefined}>
              <td>
                {item.name}
                {item.note ? ` (${item.note})` : ""}
                {item.canceled && (
                  <>
                    {" "}
                    — cancelado: {cancelReasonLabel[item.cancelReason ?? "other"]}
                    {item.cancelNote ? ` (${item.cancelNote})` : ""}
                  </>
                )}
              </td>
              <td className="amount">{item.quantity}</td>
              <td className="amount">{formatCentsToBRL(item.unitPriceCents)}</td>
              <td className="amount">{formatCentsToBRL(item.unitPriceCents * item.quantity)}</td>
              <td>
                {!item.canceled && order.status === "open" && (
                  <span className="catalog-list-actions">
                    <button
                      type="button"
                      className="button-secondary row-action-button"
                      onClick={() => handleStartEditNote(item)}
                      aria-label="Editar observação"
                      title="Editar observação"
                    >
                      <PencilIcon />
                    </button>
                    {canManageOrder && (
                      <button
                        type="button"
                        className="button-secondary row-action-button"
                        onClick={() => setCancelingItemId(item.id)}
                        aria-label="Cancelar item"
                        title="Cancelar"
                      >
                        <CancelIcon />
                      </button>
                    )}
                  </span>
                )}
              </td>
            </tr>
          ))}
          {order.items.length === 0 && (
            <tr>
              <td colSpan={5} className="catalog-empty">
                Nenhum item lançado ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="summary">
        <div className="summary-row summary-row-total">
          <span className="type-label">Subtotal</span>
          <span className="amount amount-display">{formatCentsToBRL(subtotalCents)}</span>
        </div>
      </div>

      {editingNoteItemId && (
        <div className="table-map-section">
          <h3>Editar observação</h3>
          <label>
            Observação
            <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="ex: sem cebola" autoFocus />
          </label>
          {noteError && <p className="form-error">{noteError}</p>}
          <div className="operator-form-actions">
            <button type="button" className="button-primary" onClick={handleConfirmEditNote} disabled={noteSubmitting}>
              Salvar
            </button>
            <button type="button" className="button-secondary" onClick={() => setEditingNoteItemId(null)}>
              Voltar
            </button>
          </div>
        </div>
      )}

      {cancelingItemId && (
        <div className="table-map-section">
          <h3>Cancelar item</h3>
          <label>
            Motivo
            <select value={cancelReason} onChange={(e) => setCancelReason(e.target.value as CancelReason)}>
              {cancelReasons.map((r) => (
                <option key={r} value={r}>
                  {cancelReasonLabel[r]}
                </option>
              ))}
            </select>
          </label>
          {cancelReason === "other" && (
            <label>
              Observação (obrigatória)
              <input value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} />
            </label>
          )}
          {cancelError && <p className="form-error">{cancelError}</p>}
          <div className="operator-form-actions">
            <button type="button" className="button-primary" onClick={() => handleConfirmCancel(cancelingItemId)}>
              Confirmar cancelamento
            </button>
            <button type="button" className="button-secondary" onClick={() => setCancelingItemId(null)}>
              Voltar
            </button>
          </div>
        </div>
      )}

      {order.status === "open" && (
        <>
          {pendingProduct && (
            <div className="table-map-section">
              <h3>Adicionar {pendingProduct.name}</h3>
              <label>
                Quantidade
                <input value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ""))} inputMode="numeric" />
              </label>
              <label>
                Observação (ex: sem cebola)
                <input value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              {addError && <p className="form-error">{addError}</p>}
              <div className="operator-form-actions">
                <button type="button" className="button-primary" onClick={handleConfirmAdd} disabled={adding}>
                  Confirmar
                </button>
                <button type="button" className="button-secondary" onClick={() => setPendingProduct(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <ProductSearch onQuickAdd={handleQuickAdd} onDetailedAdd={handleSelectProduct} />

          {canManageOrder &&
            (closing ? (
              <OrderClosing
                orderId={orderId}
                subtotalCents={subtotalCents}
                onClosed={() => navigate("/tables")}
              />
            ) : (
              <div className="table-map-section">
                <button type="button" className="button-primary" onClick={() => setClosing(true)}>
                  Fechar comanda
                </button>
              </div>
            ))}
        </>
      )}
    </section>
  );
}

export default Order;

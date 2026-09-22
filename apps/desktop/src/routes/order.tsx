import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSession } from "../lib/session";
import { useOrder, addItemToOrder, cancelItem } from "../lib/order";
import { useTablesAndOrders } from "../lib/tables";
import { formatCentsToBRL } from "../lib/money";
import { cancelReasonLabel, cancelReasons, type CancelReason } from "../lib/cancel-reason";
import type { Product } from "../lib/catalog";
import ProductSearch from "../product-search";
import OrderClosing from "../order-closing";

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
                {!item.canceled && canManageOrder && order.status === "open" && (
                  <button type="button" className="button-secondary" onClick={() => setCancelingItemId(item.id)}>
                    Cancelar
                  </button>
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

          <ProductSearch onSelect={handleSelectProduct} />

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

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../lib/session";
import {
  useTablesAndOrders,
  createTable,
  openTableOrder,
  openStandaloneOrder,
  transferOrder,
  renameTable,
  removeTable,
  type Table,
} from "../lib/tables";
import { defineMessages, useMessages } from "../lib/i18n";

const messages = defineMessages({
  pt: {
    loading: "Carregando...",
    title: "Mapa de Mesas",
    addTableHeading: "Cadastrar mesa",
    identifierPlaceholder: "Identificador (ex: Mesa 1)",
    capacityOptionalPlaceholder: "Capacidade (opcional)",
    add: "Adicionar",
    tablesHeading: "Mesas",
    tablesListLabel: (count: number) => `Mesas (${count})`,
    rename: "Renomear",
    remove: "Remover",
    occupied: "Ocupada",
    available: "Livre",
    seats: (count: number) => `${count} lugares`,
    openOrder: "Abrir comanda",
    newIdentifierLabel: "Novo identificador da mesa",
    capacityPlaceholder: "Capacidade",
    newCapacityLabel: "Nova capacidade da mesa",
    save: "Salvar",
    cancel: "Cancelar",
    noTables: "Nenhuma mesa cadastrada ainda.",
    standaloneHeading: "Comandas avulsas",
    openStandaloneOrder: "Abrir comanda avulsa",
    standaloneOrderLink: (number: string) => `Comanda #${number}`,
    noStandaloneOrders: "Nenhuma comanda avulsa aberta.",
    viewOrder: "Ver comanda",
    transferTo: "Transferir para",
    transferToPlaceholder: "Transferir para...",
    transfer: "Transferir",
    transferTable: "Transferir mesa",
  },
  en: {
    loading: "Loading...",
    title: "Tables",
    addTableHeading: "Add table",
    identifierPlaceholder: "Name (e.g. Table 1)",
    capacityOptionalPlaceholder: "Seats (optional)",
    add: "Add",
    tablesHeading: "Tables",
    tablesListLabel: (count: number) => `Tables (${count})`,
    rename: "Rename",
    remove: "Remove",
    occupied: "Occupied",
    available: "Available",
    seats: (count: number) => `${count} ${count === 1 ? "seat" : "seats"}`,
    openOrder: "Open tab",
    newIdentifierLabel: "New table name",
    capacityPlaceholder: "Seats",
    newCapacityLabel: "New table seat count",
    save: "Save",
    cancel: "Cancel",
    noTables: "No tables added yet.",
    standaloneHeading: "Walk-in tabs",
    openStandaloneOrder: "Open walk-in tab",
    standaloneOrderLink: (number: string) => `Tab #${number}`,
    noStandaloneOrders: "No open walk-in tabs.",
    viewOrder: "View tab",
    transferTo: "Transfer to",
    transferToPlaceholder: "Transfer to...",
    transfer: "Transfer",
    transferTable: "Transfer table",
  },
});

/* Ícones inline (SVG, stroke=currentColor, sem preenchimento, 20×20) pras
   ações administrativas compactas do table-tile — sem lib de ícone nova
   (auditoria visual 2026-09-22). aria-hidden porque o texto da ação vive
   no aria-label do botão, não no ícone. */
function PencilIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

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

/** PRD Épico 2/M5 — mapa de mesas, comandas (mesa + avulsa) e transferência. */
function TableMap() {
  const navigate = useNavigate();
  const { operator } = useSession();
  const { status, tables, orders, refresh } = useTablesAndOrders();
  const m = useMessages(messages);

  const [identifier, setIdentifier] = useState("");
  const [capacity, setCapacity] = useState("");
  const [tableError, setTableError] = useState<string | null>(null);

  const [openError, setOpenError] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<Record<string, string>>({});
  const [transferError, setTransferError] = useState<string | null>(null);
  // Achado em uso real, 2026-09-22: o select "Transferir para..." aparecia
  // sempre que a mesa tinha comanda aberta, mesmo quando ninguém ia
  // transferir nada — agora só aparece sob demanda, atrás de um botão.
  const [transferringOrderId, setTransferringOrderId] = useState<string | null>(null);

  const [renamingTableId, setRenamingTableId] = useState<string | null>(null);
  const [renameIdentifier, setRenameIdentifier] = useState("");
  const [renameCapacity, setRenameCapacity] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  if (status === "loading") {
    return (
      <section>
        <p>{m.loading}</p>
      </section>
    );
  }

  const openOrders = orders.filter((o) => o.mergedInto === undefined && o.status === "open");
  const orderForTable = (tableId: string) => openOrders.find((o) => o.currentTableId === tableId);
  const standaloneOrders = openOrders.filter((o) => o.origin.source === "standalone");
  const freeTables = (excludeTableId?: string) =>
    tables.filter((t) => t.id !== excludeTableId && !orderForTable(t.id));

  async function handleAddTable(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = identifier.trim();
    if (!trimmed) return;
    const capacityValue = capacity.trim() ? Number(capacity) : undefined;
    setTableError(null);
    const result = await createTable(trimmed, capacityValue);
    if (!result.ok) {
      setTableError(result.error);
      return;
    }
    setIdentifier("");
    setCapacity("");
    refresh();
  }

  async function handleOpenTableOrder(tableId: string) {
    setOpenError(null);
    const result = await openTableOrder(tableId);
    if (!result.ok) {
      setOpenError(result.error);
      return;
    }
    navigate(`/orders/${result.data.id}`);
  }

  async function handleOpenStandaloneOrder() {
    setOpenError(null);
    const result = await openStandaloneOrder();
    if (!result.ok) {
      setOpenError(result.error);
      return;
    }
    navigate(`/orders/${result.data.id}`);
  }

  async function handleTransfer(orderId: string) {
    const destinationTableId = transferTarget[orderId];
    if (!destinationTableId) return;
    setTransferError(null);
    const result = await transferOrder(orderId, destinationTableId);
    if (!result.ok) {
      setTransferError(result.error);
      return;
    }
    setTransferTarget((prev) => ({ ...prev, [orderId]: "" }));
    setTransferringOrderId(null);
    refresh();
  }

  function handleStartRename(t: Table) {
    setRenamingTableId(t.id);
    setRenameIdentifier(t.identifier);
    setRenameCapacity(t.capacity ? String(t.capacity) : "");
    setRenameError(null);
  }

  async function handleConfirmRename(e: React.FormEvent) {
    e.preventDefault();
    if (!renamingTableId) return;
    const trimmed = renameIdentifier.trim();
    if (!trimmed) return;
    const capacityValue = renameCapacity.trim() ? Number(renameCapacity) : undefined;
    setRenameError(null);
    const result = await renameTable(renamingTableId, { identifier: trimmed, capacity: capacityValue });
    if (!result.ok) {
      setRenameError(result.error);
      return;
    }
    setRenamingTableId(null);
    refresh();
  }

  // PRD 2.8 — remover mesa: some do mapa; 409 (comanda aberta) exibido inline.
  async function handleRemoveTable(tableId: string) {
    setRemoveError(null);
    const result = await removeTable(tableId);
    if (!result.ok) {
      setRemoveError(result.error);
      return;
    }
    refresh();
  }

  return (
    <section>
      <h1>{m.title}</h1>

      {operator?.role === "owner" && (
        <div className="table-map-section">
          <h2 className="section-heading">{m.addTableHeading}</h2>
          <form onSubmit={handleAddTable} className="inline-form">
            <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder={m.identifierPlaceholder} />
            <input
              value={capacity}
              onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ""))}
              placeholder={m.capacityOptionalPlaceholder}
              inputMode="numeric"
            />
            <button type="submit" className="button-primary" disabled={!identifier.trim()}>
              {m.add}
            </button>
          </form>
          {tableError && <p className="form-error" role="alert">{tableError}</p>}
        </div>
      )}

      {openError && <p className="form-error" role="alert">{openError}</p>}

      <div className="table-map-section">
        <h2 className="section-heading">{m.tablesHeading}</h2>
        {tables.length > 0 ? (
          // Achado na validação de acessibilidade, 2026-09-23: virou um grid
          // de <div>s sem role nenhum quando a repaginação visual trocou a
          // tabela de mesas por table-tile (2026-09-22) — leitor de tela não
          // sabia que era uma coleção de N mesas. Piso mínimo (não é a
          // arquitetura ARIA completa que o achado pede — ver
          // deferred-work.md): role="list"/"listitem" + aria-label na
          // coleção com a contagem.
          <div className="table-tile-grid" role="list" aria-label={m.tablesListLabel(tables.length)}>
            {tables.map((t) => {
              const order = orderForTable(t.id);
              return (
                <div key={t.id} role="listitem" className={`table-tile ${order ? "table-tile-occupied" : "table-tile-free"}`}>
                  <div className="table-tile-header">
                    <span className="table-tile-id">{t.identifier}</span>
                    {/* PRD 2.8 — renomear/remover mesa (dono), ao lado da identificação em
                        vez de numa segunda faixa de botões embaixo do card: ação
                        principal (Abrir/Ver comanda) e ações administrativas viviam no
                        mesmo peso visual, um botão de largura total sobre dois quadrados
                        pequenos, e liam como desalinhados (achado em uso real,
                        2026-09-22). Remover é bloqueado (409) se a mesa tiver comanda
                        aberta agora. */}
                    {operator?.role === "owner" && renamingTableId !== t.id && (
                      <span className="catalog-list-actions">
                        <button
                          type="button"
                          className="button-secondary row-action-button"
                          onClick={() => handleStartRename(t)}
                          aria-label={m.rename}
                          title={m.rename}
                        >
                          <PencilIcon />
                        </button>
                        <button
                          type="button"
                          className="button-secondary row-action-button"
                          onClick={() => handleRemoveTable(t.id)}
                          disabled={!!order}
                          aria-label={m.remove}
                          title={m.remove}
                        >
                          <TrashIcon />
                        </button>
                      </span>
                    )}
                  </div>
                  <span className="table-tile-status">{order ? m.occupied : m.available}</span>
                  {t.capacity ? <span className="table-tile-meta">{m.seats(t.capacity)}</span> : null}
                  <div className="table-tile-actions">
                    {order ? (
                      <TransferControl
                        options={freeTables(t.id)}
                        value={transferTarget[order.id] ?? ""}
                        onChange={(value) => setTransferTarget((prev) => ({ ...prev, [order.id]: value }))}
                        onSubmit={() => handleTransfer(order.id)}
                        onOpenOrder={() => navigate(`/orders/${order.id}`)}
                        isTransferring={transferringOrderId === order.id}
                        onStartTransfer={() => setTransferringOrderId(order.id)}
                        onCancelTransfer={() => setTransferringOrderId(null)}
                      />
                    ) : (
                      <button type="button" className="button-primary button-compact" onClick={() => handleOpenTableOrder(t.id)}>
                        {m.openOrder}
                      </button>
                    )}
                  </div>

                  {operator?.role === "owner" && renamingTableId === t.id && (
                    <form onSubmit={handleConfirmRename} className="table-tile-actions">
                      <input
                        value={renameIdentifier}
                        onChange={(e) => setRenameIdentifier(e.target.value)}
                        aria-label={m.newIdentifierLabel}
                      />
                      <input
                        value={renameCapacity}
                        onChange={(e) => setRenameCapacity(e.target.value.replace(/\D/g, ""))}
                        placeholder={m.capacityPlaceholder}
                        inputMode="numeric"
                        aria-label={m.newCapacityLabel}
                      />
                      <button type="submit" className="button-primary" disabled={!renameIdentifier.trim()}>
                        {m.save}
                      </button>
                      <button type="button" className="button-secondary" onClick={() => setRenamingTableId(null)}>
                        {m.cancel}
                      </button>
                      {renameError && <p className="form-error" role="alert">{renameError}</p>}
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="catalog-empty">{m.noTables}</p>
        )}
        {transferError && <p className="form-error" role="alert">{transferError}</p>}
        {removeError && <p className="form-error" role="alert">{removeError}</p>}
      </div>

      <div className="table-map-section">
        <h2 className="section-heading">{m.standaloneHeading}</h2>
        <button type="button" className="button-primary button-compact" onClick={handleOpenStandaloneOrder}>
          {m.openStandaloneOrder}
        </button>
        <ul className="catalog-list">
          {standaloneOrders.map((o) => (
            <li key={o.id}>
              <a href={`#/orders/${o.id}`}>{m.standaloneOrderLink(o.origin.source === "standalone" ? String(o.origin.number) : "")}</a>
            </li>
          ))}
          {standaloneOrders.length === 0 && <li className="catalog-empty">{m.noStandaloneOrders}</li>}
        </ul>
      </div>
    </section>
  );
}

function TransferControl({
  options,
  value,
  onChange,
  onSubmit,
  onOpenOrder,
  isTransferring,
  onStartTransfer,
  onCancelTransfer,
}: {
  options: Table[];
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onOpenOrder: () => void;
  isTransferring: boolean;
  onStartTransfer: () => void;
  onCancelTransfer: () => void;
}) {
  const m = useMessages(messages);
  return (
    <span className="transfer-control">
      <button type="button" className="button-secondary" onClick={onOpenOrder}>
        {m.viewOrder}
      </button>
      {isTransferring ? (
        <>
          <select value={value} onChange={(e) => onChange(e.target.value)} disabled={options.length === 0} aria-label={m.transferTo}>
            <option value="">{m.transferToPlaceholder}</option>
            {options.map((t) => (
              <option key={t.id} value={t.id}>
                {t.identifier}
              </option>
            ))}
          </select>
          <div className="operator-form-actions">
            <button type="button" className="button-primary" onClick={onSubmit} disabled={!value}>
              {m.transfer}
            </button>
            <button type="button" className="button-secondary" onClick={onCancelTransfer}>
              {m.cancel}
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="button-secondary" onClick={onStartTransfer} disabled={options.length === 0}>
          {m.transferTable}
        </button>
      )}
    </span>
  );
}

export default TableMap;

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../lib/session";
import {
  useTablesAndOrders,
  createTable,
  openTableOrder,
  openStandaloneOrder,
  transferOrder,
  groupTables,
  type Table,
} from "../lib/tables";

/** PRD Épico 2/M5 — mapa de mesas, comandas (mesa + avulsa), transferência e junção visual. */
function TableMap() {
  const navigate = useNavigate();
  const { operator } = useSession();
  const { status, tables, orders, tableGroups, refresh } = useTablesAndOrders();

  const [identifier, setIdentifier] = useState("");
  const [capacity, setCapacity] = useState("");
  const [tableError, setTableError] = useState<string | null>(null);

  const [openError, setOpenError] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<Record<string, string>>({});
  const [transferError, setTransferError] = useState<string | null>(null);

  const [selectedForGroup, setSelectedForGroup] = useState<string[]>([]);
  const [groupError, setGroupError] = useState<string | null>(null);

  if (status === "loading") {
    return (
      <section>
        <p>Carregando...</p>
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
    refresh();
  }

  function toggleSelectedForGroup(tableId: string) {
    setSelectedForGroup((prev) => (prev.includes(tableId) ? prev.filter((id) => id !== tableId) : [...prev, tableId]));
  }

  async function handleGroupTables() {
    setGroupError(null);
    const result = await groupTables(selectedForGroup);
    if (!result.ok) {
      setGroupError(result.error);
      return;
    }
    setSelectedForGroup([]);
    refresh();
  }

  const tableLabel = (tableId: string) => tables.find((t) => t.id === tableId)?.identifier ?? "—";

  return (
    <section>
      <h2>Mapa de Mesas</h2>

      {operator?.role === "owner" && (
        <div className="table-map-section">
          <h3>Cadastrar mesa</h3>
          <form onSubmit={handleAddTable} className="inline-form">
            <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Identificador (ex: Mesa 1)" />
            <input
              value={capacity}
              onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ""))}
              placeholder="Capacidade (opcional)"
              inputMode="numeric"
            />
            <button type="submit" className="button-primary" disabled={!identifier.trim()}>
              Adicionar
            </button>
          </form>
          {tableError && <p className="form-error">{tableError}</p>}
        </div>
      )}

      {openError && <p className="form-error">{openError}</p>}

      <div className="table-map-section">
        <h3>Mesas</h3>
        {tables.length > 0 ? (
          <div className="table-tile-grid">
            {tables.map((t) => {
              const order = orderForTable(t.id);
              return (
                <div key={t.id} className={`table-tile ${order ? "table-tile-occupied" : "table-tile-free"}`}>
                  <div className="table-tile-header">
                    <span className="table-tile-id">{t.identifier}</span>
                    <label className="tap-area">
                      <input
                        type="checkbox"
                        checked={selectedForGroup.includes(t.id)}
                        onChange={() => toggleSelectedForGroup(t.id)}
                        aria-label={`Selecionar ${t.identifier} pra agrupar`}
                      />
                    </label>
                  </div>
                  <span className="table-tile-status">{order ? "Ocupada" : "Livre"}</span>
                  {t.capacity ? <span className="table-tile-meta">{t.capacity} lugares</span> : null}
                  <div className="table-tile-actions">
                    {order ? (
                      <TransferControl
                        options={freeTables(t.id)}
                        value={transferTarget[order.id] ?? ""}
                        onChange={(value) => setTransferTarget((prev) => ({ ...prev, [order.id]: value }))}
                        onSubmit={() => handleTransfer(order.id)}
                        onOpenOrder={() => navigate(`/orders/${order.id}`)}
                      />
                    ) : (
                      <button type="button" className="button-primary" onClick={() => handleOpenTableOrder(t.id)}>
                        Abrir comanda
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="catalog-empty">Nenhuma mesa cadastrada ainda.</p>
        )}
        {transferError && <p className="form-error">{transferError}</p>}
      </div>

      <div className="table-map-section">
        <h3>Junção de mesas</h3>
        <button type="button" className="button-primary" onClick={handleGroupTables} disabled={selectedForGroup.length < 2}>
          Agrupar mesas selecionadas
        </button>
        {groupError && <p className="form-error">{groupError}</p>}
        <ul className="catalog-list">
          {tableGroups.map((g) => (
            <li key={g.id}>{g.tableIds.map(tableLabel).join(" + ")}</li>
          ))}
          {tableGroups.length === 0 && <li className="catalog-empty">Nenhuma junção ainda.</li>}
        </ul>
      </div>

      <div className="table-map-section">
        <h3>Comandas avulsas</h3>
        <button type="button" className="button-primary" onClick={handleOpenStandaloneOrder}>
          Abrir comanda avulsa
        </button>
        <ul className="catalog-list">
          {standaloneOrders.map((o) => (
            <li key={o.id}>
              <a href={`#/orders/${o.id}`}>Comanda #{o.origin.source === "standalone" ? o.origin.number : ""}</a>
            </li>
          ))}
          {standaloneOrders.length === 0 && <li className="catalog-empty">Nenhuma comanda avulsa aberta.</li>}
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
}: {
  options: Table[];
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onOpenOrder: () => void;
}) {
  return (
    <span className="transfer-control">
      <button type="button" className="button-secondary" onClick={onOpenOrder}>
        Ver comanda
      </button>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={options.length === 0} aria-label="Transferir para">
        <option value="">Transferir para...</option>
        {options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.identifier}
          </option>
        ))}
      </select>
      <button type="button" className="button-secondary" onClick={onSubmit} disabled={!value}>
        Transferir
      </button>
    </span>
  );
}

export default TableMap;

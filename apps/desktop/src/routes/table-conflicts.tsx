import { useTableConflicts } from "../lib/table-conflicts";

/**
 * ARCH §4.2 — histórico completo de conflitos de mesa: duas `order_opened`
 * pra mesma mesa, geradas por terminais offline sem se enxergar na LAN,
 * resolvidas automaticamente (menor HLC vence, itens da outra reatribuídos
 * a ela). O banner em `layout.tsx` (`useMergeWarnings`) é a notificação
 * transitória — só conflitos recentes (24h), dá pra dispensar (por
 * terminal, não sincroniza); esta tela é o registro permanente "visível ao
 * dono" que o ARCH já prometia, com uma ação de verdade pra marcar como
 * revisado (achado em uso real, 2026-09-23: sem isso, o registro ficava
 * pra sempre com cara de pendência sem solução).
 */
function TableConflicts() {
  const { status, conflicts, tableLabel, resolve, resolveError } = useTableConflicts();

  if (status === "loading") {
    return (
      <section>
        <p>Carregando...</p>
      </section>
    );
  }

  const sorted = [...conflicts].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <section>
      <h2>Conflitos de Mesas</h2>
      <p className="type-label">
        Quando dois terminais abrem comanda pra mesma mesa offline ao mesmo
        tempo, o sistema mescla automaticamente: a comanda mais antiga fica
        aberta, e os itens lançados na outra são reatribuídos a ela. Marcar
        como resolvido só registra que você já revisou o caso (ex: conferiu
        com o cliente) — não desfaz a mesclagem nem apaga o histórico.
      </p>

      {resolveError && <p className="form-error">{resolveError}</p>}

      <ul className="catalog-list">
        {sorted.map((conflict) => (
          <li key={conflict.losingOrder}>
            <div>
              <strong>{tableLabel(conflict.tableId)}</strong>
              <div className="type-label">{new Date(conflict.createdAt).toLocaleString("pt-BR")}</div>
            </div>
            <span className="catalog-list-actions">
              <a href={`#/orders/${conflict.canonicalOrder}`} className="button-secondary">
                Ver comanda que ficou aberta
              </a>
              {conflict.resolvedAt ? (
                <span className="status-badge status-badge-success">
                  Resolvido em {new Date(conflict.resolvedAt).toLocaleDateString("pt-BR")}
                </span>
              ) : (
                <button type="button" className="button-primary" onClick={() => resolve(conflict.losingOrder)}>
                  Marcar como resolvido
                </button>
              )}
            </span>
          </li>
        ))}
        {sorted.length === 0 && <li className="catalog-empty">Nenhum conflito de mesa registrado ainda.</li>}
      </ul>
    </section>
  );
}

export default TableConflicts;

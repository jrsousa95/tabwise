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

  // Achado na validação de UX, 2026-09-23: histórico é um log que só
  // cresce (nunca encolhe, ao contrário de mesas/produtos) — ordenar só
  // por data enterrava conflitos pendentes no meio de outros já resolvidos
  // há tempos. Pendentes sempre primeiro; dentro de cada grupo, mais
  // recente primeiro.
  const sorted = [...conflicts].sort((a, b) => {
    const pendingDiff = Number(a.resolvedAt !== undefined) - Number(b.resolvedAt !== undefined);
    return pendingDiff !== 0 ? pendingDiff : b.createdAt - a.createdAt;
  });

  return (
    <section>
      <h1>Conflitos de Mesas</h1>
      {/* Achado na validação de UX, 2026-09-23: .type-label (rótulo 13px)
          usado num parágrafo de 4 frases — texto corrido lê mais rápido. */}
      <p>
        Quando dois terminais abrem comanda pra mesma mesa offline ao mesmo
        tempo, o sistema mescla automaticamente: a comanda mais antiga fica
        aberta, e os itens lançados na outra são reatribuídos a ela. Marcar
        como resolvido só registra que você já revisou o caso (ex: conferiu
        com o cliente) — não desfaz a mesclagem nem apaga o histórico.
      </p>

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

      {/* Achado na validação de UX, 2026-09-23: erro aparecia antes da
          lista onde a ação foi disparada — todo outro erro de ação de
          linha do app (Cardápio, Mapa de Mesas) vem depois do bloco. */}
      {resolveError && <p className="form-error" role="alert">{resolveError}</p>}
    </section>
  );
}

export default TableConflicts;

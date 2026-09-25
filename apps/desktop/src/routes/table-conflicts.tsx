import { useTableConflicts } from "../lib/table-conflicts";
import { formatCentsToBRL } from "../lib/money";

/**
 * ARCH §4.2/§4.4, UX-DR4 (decidido com o dono, 2026-09-25) — histórico
 * completo de conflitos resolvidos automaticamente por HLC: duas
 * `order_opened` pra mesma mesa (mesa) OU duas `cash_session_opened`
 * concorrentes (sessão de caixa, Épico 1/Story 1.1), sempre geradas por
 * terminais offline sem se enxergar na LAN. Renomeada de "Conflitos de
 * Mesas" pra algo mais genérico porque agora lista os dois mecanismos — o
 * banner em `layout.tsx` (`useMergeWarnings`) continua sendo só a
 * notificação transitória de mesa (24h, dispensável por terminal); esta
 * tela é o registro permanente "visível ao dono".
 */
function TableConflicts() {
  const { status, conflicts, cashSessionConflicts, tableLabel, cashSessionAmount, resolve, resolveError } = useTableConflicts();

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
  const sortedCashSessionConflicts = [...cashSessionConflicts].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <section>
      <h1>Conflitos de Sincronização</h1>
      {/* Achado na validação de UX, 2026-09-23: .type-label (rótulo 13px)
          usado num parágrafo de 4 frases — texto corrido lê mais rápido. */}
      <p>
        Quando dois terminais fazem a mesma ação offline ao mesmo tempo sem se
        enxergar (abrir comanda na mesma mesa, ou abrir sessão de caixa), o
        sistema mescla automaticamente: o registro mais antigo fica
        valendo, e o outro é marcado como conflito — nunca trava o operador.
        Marcar como resolvido só registra que você já revisou o caso; não
        desfaz a mesclagem nem apaga o histórico.
      </p>

      <h2 className="section-heading">Conflitos de mesa</h2>
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

      {/* Épico 1 (Sessão de Caixa), Story 1.1 — ainda não existe uma ação
          de "marcar como resolvido" pra esse tipo (não há evento
          equivalente a `table_conflict_resolved` pra sessão de caixa
          nesta story); fica como aviso não bloqueante, só leitura. */}
      <h2 className="section-heading">Conflitos de sessão de caixa</h2>
      <ul className="catalog-list">
        {sortedCashSessionConflicts.map((conflict) => {
          const losingAmount = cashSessionAmount(conflict.losingSession);
          const canonicalAmount = cashSessionAmount(conflict.canonicalSession);
          return (
            <li key={conflict.losingSession}>
              <div>
                <strong>
                  Sessão de caixa{losingAmount !== undefined ? ` (fundo de ${formatCentsToBRL(losingAmount)})` : ""}
                </strong>
                <div className="type-label">{new Date(conflict.createdAt).toLocaleString("pt-BR")}</div>
              </div>
              <span className="status-badge status-badge-warning">
                mesclada na sessão {canonicalAmount !== undefined ? `de ${formatCentsToBRL(canonicalAmount)}` : "canônica"}
              </span>
            </li>
          );
        })}
        {sortedCashSessionConflicts.length === 0 && (
          <li className="catalog-empty">Nenhum conflito de sessão de caixa registrado ainda.</li>
        )}
      </ul>

      {/* Achado na validação de UX, 2026-09-23: erro aparecia antes da
          lista onde a ação foi disparada — todo outro erro de ação de
          linha do app (Cardápio, Mapa de Mesas) vem depois do bloco. */}
      {resolveError && <p className="form-error" role="alert">{resolveError}</p>}
    </section>
  );
}

export default TableConflicts;

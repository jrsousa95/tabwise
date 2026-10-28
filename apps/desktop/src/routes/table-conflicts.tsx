import { useTableConflicts } from "../lib/table-conflicts";
import { formatCentsToBRL } from "../lib/money";
import { defineMessages, useMessages, formatDate, formatDateTime } from "../lib/i18n";

const messages = defineMessages({
  pt: {
    loading: "Carregando...",
    title: "Conflitos de Sincronização",
    intro:
      "Quando dois terminais fazem a mesma ação offline ao mesmo tempo sem se enxergar (abrir comanda na mesma mesa, ou abrir sessão de caixa), o sistema mescla automaticamente: o registro mais antigo fica valendo, e o outro é marcado como conflito — nunca trava o operador. Marcar como resolvido só registra que você já revisou o caso; não desfaz a mesclagem nem apaga o histórico.",
    tableConflictsHeading: "Conflitos de mesa",
    viewOpenOrder: "Ver comanda que ficou aberta",
    resolvedOn: (date: string) => `Resolvido em ${date}`,
    markResolved: "Marcar como resolvido",
    noTableConflicts: "Nenhum conflito de mesa registrado ainda.",
    cashSessionConflictsHeading: "Conflitos de sessão de caixa",
    cashSession: "Sessão de caixa",
    openingFloat: (amount: string) => ` (fundo de ${amount})`,
    mergedIntoAmount: (amount: string) => `mesclada na sessão de ${amount}`,
    mergedIntoCanonical: "mesclada na sessão canônica",
    noCashSessionConflicts: "Nenhum conflito de sessão de caixa registrado ainda.",
  },
  en: {
    loading: "Loading...",
    title: "Sync Conflicts",
    intro:
      "When two terminals do the same thing offline at the same time without seeing each other (opening a tab on the same table, or opening a cash session), the system merges them automatically: the older record wins and the other one is flagged as a conflict — staff are never blocked. Marking a conflict as resolved only records that you've reviewed it; it doesn't undo the merge or erase the history.",
    tableConflictsHeading: "Table conflicts",
    viewOpenOrder: "View the tab that stayed open",
    resolvedOn: (date: string) => `Resolved on ${date}`,
    markResolved: "Mark as resolved",
    noTableConflicts: "No table conflicts recorded yet.",
    cashSessionConflictsHeading: "Cash session conflicts",
    cashSession: "Cash session",
    openingFloat: (amount: string) => ` (opening float ${amount})`,
    mergedIntoAmount: (amount: string) => `merged into the ${amount} session`,
    mergedIntoCanonical: "merged into the canonical session",
    noCashSessionConflicts: "No cash session conflicts recorded yet.",
  },
});

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
  const m = useMessages(messages);
  const { status, conflicts, cashSessionConflicts, tableLabel, cashSessionAmount, resolve, resolveError } = useTableConflicts();

  if (status === "loading") {
    return (
      <section>
        <p>{m.loading}</p>
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
      <h1>{m.title}</h1>
      {/* Achado na validação de UX, 2026-09-23: .type-label (rótulo 13px)
          usado num parágrafo de 4 frases — texto corrido lê mais rápido. */}
      <p>{m.intro}</p>

      <h2 className="section-heading">{m.tableConflictsHeading}</h2>
      <ul className="catalog-list">
        {sorted.map((conflict) => (
          <li key={conflict.losingOrder}>
            <div>
              <strong>{tableLabel(conflict.tableId)}</strong>
              <div className="type-label">{formatDateTime(conflict.createdAt)}</div>
            </div>
            <span className="catalog-list-actions">
              <a href={`#/orders/${conflict.canonicalOrder}`} className="button-secondary">
                {m.viewOpenOrder}
              </a>
              {conflict.resolvedAt ? (
                <span className="status-badge status-badge-success">
                  {m.resolvedOn(formatDate(conflict.resolvedAt))}
                </span>
              ) : (
                <button type="button" className="button-primary" onClick={() => resolve(conflict.losingOrder)}>
                  {m.markResolved}
                </button>
              )}
            </span>
          </li>
        ))}
        {sorted.length === 0 && <li className="catalog-empty">{m.noTableConflicts}</li>}
      </ul>

      {/* Épico 1 (Sessão de Caixa), Story 1.1 — ainda não existe uma ação
          de "marcar como resolvido" pra esse tipo (não há evento
          equivalente a `table_conflict_resolved` pra sessão de caixa
          nesta story); fica como aviso não bloqueante, só leitura. */}
      <h2 className="section-heading">{m.cashSessionConflictsHeading}</h2>
      <ul className="catalog-list">
        {sortedCashSessionConflicts.map((conflict) => {
          const losingAmount = cashSessionAmount(conflict.losingSession);
          const canonicalAmount = cashSessionAmount(conflict.canonicalSession);
          return (
            <li key={conflict.losingSession}>
              <div>
                <strong>
                  {m.cashSession}{losingAmount !== undefined ? m.openingFloat(formatCentsToBRL(losingAmount)) : ""}
                </strong>
                <div className="type-label">{formatDateTime(conflict.createdAt)}</div>
              </div>
              <span className="status-badge status-badge-warning">
                {canonicalAmount !== undefined ? m.mergedIntoAmount(formatCentsToBRL(canonicalAmount)) : m.mergedIntoCanonical}
              </span>
            </li>
          );
        })}
        {sortedCashSessionConflicts.length === 0 && (
          <li className="catalog-empty">{m.noCashSessionConflicts}</li>
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

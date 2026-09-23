import { useMergeAudit } from "../lib/merge-audit";

/**
 * ARCH §4.2 — auditoria completa de mesclagens automáticas de comanda: duas
 * `order_opened` pra mesma mesa, geradas por terminais offline sem se
 * enxergar na LAN, resolvidas automaticamente (menor HLC vence, itens da
 * outra reatribuídos a ela). O banner em `layout.tsx` (`useMergeWarnings`)
 * é a notificação transitória — só mesclagens recentes (24h), dá pra
 * dispensar; esta tela é o registro permanente "visível ao dono" que o
 * ARCH já prometia mas nunca teve tela própria (achado registrado em
 * `_bmad-output/implementation-artifacts/deferred-work.md`).
 */
function MergeAudit() {
  const { status, entries, tableLabel } = useMergeAudit();

  if (status === "loading") {
    return (
      <section>
        <p>Carregando...</p>
      </section>
    );
  }

  const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <section>
      <h2>Auditoria de Mesclagens</h2>
      <p className="type-label">
        Quando dois terminais abrem comanda pra mesma mesa offline ao mesmo
        tempo, o sistema mescla automaticamente: a comanda mais antiga fica
        aberta, e os itens lançados na outra são reatribuídos a ela. Este é
        o histórico completo — continua aqui mesmo depois que o aviso no
        terminal já foi dispensado.
      </p>

      <ul className="catalog-list">
        {sorted.map((entry) => (
          <li key={entry.losingOrder}>
            <div>
              <strong>{tableLabel(entry.tableId)}</strong>
              <div className="type-label">{new Date(entry.createdAt).toLocaleString("pt-BR")}</div>
            </div>
            <a href={`#/orders/${entry.canonicalOrder}`} className="button-secondary">
              Ver comanda que ficou aberta
            </a>
          </li>
        ))}
        {sorted.length === 0 && <li className="catalog-empty">Nenhuma mesclagem automática registrada ainda.</li>}
      </ul>
    </section>
  );
}

export default MergeAudit;

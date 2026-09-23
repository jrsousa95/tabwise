import { useMemo, useState } from "react";
import { useCatalog, type Product } from "./lib/catalog";
import { formatCentsToBRL } from "./lib/money";

/* Ícone inline (SVG, stroke=currentColor, sem preenchimento, 20×20) — mesmo
   padrão já usado nas outras telas. Adição rápida: 1 clique = 1 unidade,
   sem passar pelo formulário de quantidade/observação (achado em uso real,
   2026-09-22: lançar 1 unidade sem nota era "muito trabalhoso"). */
function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
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

/**
 * PRD 3.3 — busca de produto por nome/categoria. Só produtos ativos
 * aparecem aqui (PRD 3.2). `onQuickAdd`/`onDetailedAdd` são opcionais: sem
 * eles, é só a busca "de vitrine" entregue no M4; com eles (M6, tela de
 * comanda), cada resultado ganha um "+" de adição rápida (1 clique = 1
 * unidade, sem nota) e um botão secundário de "quantidade/observação" pro
 * formulário detalhado (achado em uso real, 2026-09-22).
 */
function ProductSearch({
  onQuickAdd,
  onDetailedAdd,
}: {
  onQuickAdd?: (product: Product) => void;
  onDetailedAdd?: (product: Product) => void;
}) {
  const { status, categories, products } = useCatalog();
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return products
      .filter((p) => p.active)
      .filter((p) => (categoryId ? p.categoryId === categoryId : true))
      .filter((p) => (normalizedQuery ? p.name.toLowerCase().includes(normalizedQuery) : true));
  }, [products, query, categoryId]);

  if (status === "loading") return null;

  return (
    <div className="product-search">
      <h2 className="section-heading">Buscar produto</h2>
      <div className="inline-form">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nome do produto" aria-label="Buscar por nome" />
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Filtrar por categoria">
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <ul className="catalog-list">
        {results.map((p) => (
          <li key={p.id} className={onQuickAdd ? "product-search-result" : undefined}>
            <span>
              {p.name} — <span className="amount">{formatCentsToBRL(p.priceCents)}</span>
            </span>
            {onQuickAdd && (
              <span className="catalog-list-actions">
                <button
                  type="button"
                  className="button-primary row-action-button"
                  onClick={() => onQuickAdd(p)}
                  aria-label={`Adicionar 1 ${p.name}`}
                  title="Adicionar 1"
                >
                  <PlusIcon />
                </button>
                {onDetailedAdd && (
                  <button
                    type="button"
                    className="button-secondary row-action-button"
                    onClick={() => onDetailedAdd(p)}
                    aria-label={`Adicionar ${p.name} com quantidade ou observação`}
                    title="Quantidade / observação"
                  >
                    <PencilIcon />
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
        {results.length === 0 && <li className="catalog-empty">Nenhum produto encontrado.</li>}
      </ul>
    </div>
  );
}

export default ProductSearch;

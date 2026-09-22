import { useMemo, useState } from "react";
import { useCatalog, type Product } from "./lib/catalog";
import { formatCentsToBRL } from "./lib/money";

/**
 * PRD 3.3 — busca de produto por nome/categoria. Só produtos ativos
 * aparecem aqui (PRD 3.2). `onSelect` é opcional: sem ele, é só a busca
 * "de vitrine" entregue no M4; com ele (M6, tela de comanda), cada
 * resultado vira um botão "Adicionar".
 */
function ProductSearch({ onSelect }: { onSelect?: (product: Product) => void }) {
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
      <h3>Buscar produto</h3>
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
          <li key={p.id} className={onSelect ? "product-search-result" : undefined}>
            <span>
              {p.name} — <span className="amount">{formatCentsToBRL(p.priceCents)}</span>
            </span>
            {onSelect && (
              <button type="button" className="button-secondary" onClick={() => onSelect(p)}>
                Adicionar
              </button>
            )}
          </li>
        ))}
        {results.length === 0 && <li className="catalog-empty">Nenhum produto encontrado.</li>}
      </ul>
    </div>
  );
}

export default ProductSearch;

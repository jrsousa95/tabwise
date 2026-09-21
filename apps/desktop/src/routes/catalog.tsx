import { useState } from "react";
import { useCatalog, createCategory, createProduct, setProductActive } from "../lib/catalog";
import { formatCentsToBRL, parseReaisToCents } from "../lib/money";

/** PRD Épico 3/M4 — cadastro de categorias e produtos (dono). */
function Catalog() {
  const { status, categories, products, refresh } = useCatalog();

  const [categoryName, setCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categorySubmitting, setCategorySubmitting] = useState(false);

  const [productName, setProductName] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [productCategoryId, setProductCategoryId] = useState("");
  const [productError, setProductError] = useState<string | null>(null);
  const [productSubmitting, setProductSubmitting] = useState(false);

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    const name = categoryName.trim();
    if (!name || categorySubmitting) return;
    setCategorySubmitting(true);
    setCategoryError(null);
    const result = await createCategory(name);
    setCategorySubmitting(false);
    if (!result.ok) {
      setCategoryError(result.error);
      return;
    }
    setCategoryName("");
    refresh();
  }

  async function handleAddProduct(e: React.FormEvent) {
    e.preventDefault();
    const name = productName.trim();
    const priceCents = parseReaisToCents(productPrice);
    if (!name || priceCents === null || !productCategoryId || productSubmitting) return;
    setProductSubmitting(true);
    setProductError(null);
    const result = await createProduct({ name, priceCents, categoryId: productCategoryId, active: true });
    setProductSubmitting(false);
    if (!result.ok) {
      setProductError(result.error);
      return;
    }
    setProductName("");
    setProductPrice("");
    refresh();
  }

  async function handleToggleActive(productId: string, active: boolean) {
    await setProductActive(productId, active);
    refresh();
  }

  if (status === "loading") {
    return (
      <section>
        <p>Carregando...</p>
      </section>
    );
  }

  const categoryLabel = (categoryId: string) => categories.find((c) => c.id === categoryId)?.name ?? "—";

  return (
    <section className="catalog">
      <div className="catalog-column">
        <h2>Categorias</h2>
        <form onSubmit={handleAddCategory} className="inline-form">
          <input
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            placeholder="Ex: Bebidas"
            aria-label="Nome da categoria"
          />
          <button type="submit" disabled={!categoryName.trim() || categorySubmitting}>
            Adicionar
          </button>
        </form>
        {categoryError && <p className="form-error">{categoryError}</p>}
        <ul className="catalog-list">
          {categories.map((c) => (
            <li key={c.id}>{c.name}</li>
          ))}
          {categories.length === 0 && <li className="catalog-empty">Nenhuma categoria ainda.</li>}
        </ul>
      </div>

      <div className="catalog-column">
        <h2>Produtos</h2>
        <form onSubmit={handleAddProduct} className="operator-form">
          <label>
            Nome
            <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Ex: Cerveja" />
          </label>
          <label>
            Preço (R$)
            <input value={productPrice} onChange={(e) => setProductPrice(e.target.value)} placeholder="Ex: 12,50" inputMode="decimal" />
          </label>
          <label>
            Categoria
            <select value={productCategoryId} onChange={(e) => setProductCategoryId(e.target.value)} disabled={categories.length === 0}>
              <option value="">Selecione...</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {categories.length === 0 && <p className="form-error">Cadastre uma categoria antes de adicionar produtos.</p>}
          {productError && <p className="form-error">{productError}</p>}
          <button
            type="submit"
            disabled={!productName.trim() || parseReaisToCents(productPrice) === null || !productCategoryId || productSubmitting}
          >
            Adicionar
          </button>
        </form>

        <table className="catalog-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Categoria</th>
              <th>Preço</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className={p.active ? undefined : "catalog-row-inactive"}>
                <td>{p.name}</td>
                <td>{categoryLabel(p.categoryId)}</td>
                <td>{formatCentsToBRL(p.priceCents)}</td>
                <td>{p.active ? "Ativo" : "Inativo"}</td>
                <td>
                  <button type="button" onClick={() => handleToggleActive(p.id, !p.active)}>
                    {p.active ? "Desativar" : "Ativar"}
                  </button>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={5} className="catalog-empty">
                  Nenhum produto ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default Catalog;

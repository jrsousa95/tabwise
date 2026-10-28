import { useState } from "react";
import {
  useCatalog,
  createCategory,
  createProduct,
  setProductActive,
  renameCategory,
  removeCategory,
  renameProduct,
  removeProduct,
} from "../lib/catalog";
import { formatCentsToBRL, parseReaisToCents } from "../lib/money";
import { defineMessages, useMessages } from "../lib/i18n";

const messages = defineMessages({
  pt: {
    loading: "Carregando...",
    title: "Cardápio",
    categories: "Categorias",
    categoryPlaceholder: "Ex: Bebidas",
    categoryNameLabel: "Nome da categoria",
    add: "Adicionar",
    newCategoryNameLabel: "Novo nome da categoria",
    save: "Salvar",
    cancel: "Cancelar",
    rename: "Renomear",
    remove: "Remover",
    noCategories: "Nenhuma categoria ainda.",
    products: "Produtos",
    name: "Nome",
    productPlaceholder: "Ex: Cerveja",
    priceLabel: "Preço (R$)",
    pricePlaceholder: "Ex: 12,50",
    category: "Categoria",
    selectPlaceholder: "Selecione...",
    categoryRequired: "Cadastre uma categoria antes de adicionar produtos.",
    price: "Preço",
    status: "Status",
    newProductNameLabel: "Novo nome do produto",
    active: "Ativo",
    inactive: "Inativo",
    deactivate: "Desativar",
    activate: "Ativar",
    noProducts: "Nenhum produto ainda.",
  },
  en: {
    loading: "Loading...",
    title: "Menu",
    categories: "Categories",
    categoryPlaceholder: "e.g. Drinks",
    categoryNameLabel: "Category name",
    add: "Add",
    newCategoryNameLabel: "New category name",
    save: "Save",
    cancel: "Cancel",
    rename: "Rename",
    remove: "Remove",
    noCategories: "No categories yet.",
    products: "Products",
    name: "Name",
    productPlaceholder: "e.g. Beer",
    priceLabel: "Price (R$)",
    pricePlaceholder: "e.g. 12.50",
    category: "Category",
    selectPlaceholder: "Select...",
    categoryRequired: "Add a category before adding products.",
    price: "Price",
    status: "Status",
    newProductNameLabel: "New product name",
    active: "Active",
    inactive: "Inactive",
    deactivate: "Deactivate",
    activate: "Activate",
    noProducts: "No products yet.",
  },
});

/* Ícones inline (SVG, stroke=currentColor, sem preenchimento, 20×20) pra
   ações de linha compactas — sem lib de ícone nova (auditoria visual
   2026-09-22). aria-hidden porque o texto da ação vive no aria-label do
   botão, não no ícone. */
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

function PowerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2v8" />
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
    </svg>
  );
}

/** PRD Épico 3/M4 — cadastro de categorias e produtos (dono). */
function Catalog() {
  const m = useMessages(messages);
  const { status, categories, products, refresh } = useCatalog();

  const [categoryName, setCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categorySubmitting, setCategorySubmitting] = useState(false);

  const [productName, setProductName] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [productCategoryId, setProductCategoryId] = useState("");
  const [productError, setProductError] = useState<string | null>(null);
  const [productSubmitting, setProductSubmitting] = useState(false);

  const [renamingCategoryId, setRenamingCategoryId] = useState<string | null>(null);
  const [renameCategoryName, setRenameCategoryName] = useState("");
  const [categoryActionError, setCategoryActionError] = useState<string | null>(null);
  const [categoryActionSubmitting, setCategoryActionSubmitting] = useState(false);

  const [renamingProductId, setRenamingProductId] = useState<string | null>(null);
  const [renameProductName, setRenameProductName] = useState("");
  const [productActionError, setProductActionError] = useState<string | null>(null);
  const [productActionSubmitting, setProductActionSubmitting] = useState(false);

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

  function handleStartRenameCategory(id: string, currentName: string) {
    setRenamingCategoryId(id);
    setRenameCategoryName(currentName);
    setCategoryActionError(null);
  }

  async function handleConfirmRenameCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!renamingCategoryId || categoryActionSubmitting) return;
    const name = renameCategoryName.trim();
    if (!name) return;
    setCategoryActionSubmitting(true);
    setCategoryActionError(null);
    const result = await renameCategory(renamingCategoryId, name);
    setCategoryActionSubmitting(false);
    if (!result.ok) {
      setCategoryActionError(result.error);
      return;
    }
    setRenamingCategoryId(null);
    refresh();
  }

  async function handleRemoveCategory(id: string) {
    if (categoryActionSubmitting) return;
    setCategoryActionSubmitting(true);
    setCategoryActionError(null);
    const result = await removeCategory(id);
    setCategoryActionSubmitting(false);
    if (!result.ok) {
      setCategoryActionError(result.error);
      return;
    }
    refresh();
  }

  function handleStartRenameProduct(id: string, currentName: string) {
    setRenamingProductId(id);
    setRenameProductName(currentName);
    setProductActionError(null);
  }

  async function handleConfirmRenameProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!renamingProductId || productActionSubmitting) return;
    const name = renameProductName.trim();
    if (!name) return;
    setProductActionSubmitting(true);
    setProductActionError(null);
    const result = await renameProduct(renamingProductId, name);
    setProductActionSubmitting(false);
    if (!result.ok) {
      setProductActionError(result.error);
      return;
    }
    setRenamingProductId(null);
    refresh();
  }

  async function handleRemoveProduct(id: string) {
    if (productActionSubmitting) return;
    setProductActionSubmitting(true);
    setProductActionError(null);
    const result = await removeProduct(id);
    setProductActionSubmitting(false);
    if (!result.ok) {
      setProductActionError(result.error);
      return;
    }
    refresh();
  }

  if (status === "loading") {
    return (
      <section>
        <p>{m.loading}</p>
      </section>
    );
  }

  const categoryLabel = (categoryId: string) => categories.find((c) => c.id === categoryId)?.name ?? "—";

  return (
    <section>
      <h1>{m.title}</h1>
      <div className="catalog">
        <div className="catalog-column">
        <h2 className="section-heading">{m.categories}</h2>
        <form onSubmit={handleAddCategory} className="inline-form">
          <input
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            placeholder={m.categoryPlaceholder}
            aria-label={m.categoryNameLabel}
          />
          <button type="submit" className="button-primary" disabled={!categoryName.trim() || categorySubmitting}>
            {m.add}
          </button>
        </form>
        {categoryError && <p className="form-error" role="alert">{categoryError}</p>}
        <ul className="catalog-list">
          {categories.map((c) =>
            renamingCategoryId === c.id ? (
              <li key={c.id}>
                <form onSubmit={handleConfirmRenameCategory} className="inline-form">
                  <input
                    value={renameCategoryName}
                    onChange={(e) => setRenameCategoryName(e.target.value)}
                    aria-label={m.newCategoryNameLabel}
                  />
                  <button type="submit" className="button-primary" disabled={!renameCategoryName.trim() || categoryActionSubmitting}>
                    {m.save}
                  </button>
                  <button type="button" className="button-secondary" onClick={() => setRenamingCategoryId(null)}>
                    {m.cancel}
                  </button>
                </form>
              </li>
            ) : (
              <li key={c.id}>
                <span>{c.name}</span>
                <span className="catalog-list-actions">
                  <button
                    type="button"
                    className="button-secondary row-action-button"
                    onClick={() => handleStartRenameCategory(c.id, c.name)}
                    disabled={categoryActionSubmitting}
                    aria-label={m.rename}
                    title={m.rename}
                  >
                    <PencilIcon />
                  </button>
                  <button
                    type="button"
                    className="button-secondary row-action-button"
                    onClick={() => handleRemoveCategory(c.id)}
                    disabled={categoryActionSubmitting}
                    aria-label={m.remove}
                    title={m.remove}
                  >
                    <TrashIcon />
                  </button>
                </span>
              </li>
            )
          )}
          {categories.length === 0 && <li className="catalog-empty">{m.noCategories}</li>}
        </ul>
        {categoryActionError && <p className="form-error" role="alert">{categoryActionError}</p>}
      </div>

      <div className="catalog-column">
        <h2 className="section-heading">{m.products}</h2>
        <form onSubmit={handleAddProduct} className="operator-form">
          <label>
            {m.name}
            <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder={m.productPlaceholder} />
          </label>
          <label>
            {m.priceLabel}
            <input value={productPrice} onChange={(e) => setProductPrice(e.target.value)} placeholder={m.pricePlaceholder} inputMode="decimal" />
          </label>
          <label>
            {m.category}
            <select value={productCategoryId} onChange={(e) => setProductCategoryId(e.target.value)} disabled={categories.length === 0}>
              <option value="">{m.selectPlaceholder}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {categories.length === 0 && <p className="form-error" role="alert">{m.categoryRequired}</p>}
          {productError && <p className="form-error" role="alert">{productError}</p>}
          <button
            type="submit"
            className="button-primary"
            disabled={!productName.trim() || parseReaisToCents(productPrice) === null || !productCategoryId || productSubmitting}
          >
            {m.add}
          </button>
        </form>

        <table className="catalog-table">
          <thead>
            <tr>
              <th>{m.name}</th>
              <th>{m.category}</th>
              <th>{m.price}</th>
              <th>{m.status}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) =>
              renamingProductId === p.id ? (
                <tr key={p.id}>
                  <td colSpan={5}>
                    <form onSubmit={handleConfirmRenameProduct} className="inline-form">
                      <input
                        value={renameProductName}
                        onChange={(e) => setRenameProductName(e.target.value)}
                        aria-label={m.newProductNameLabel}
                      />
                      <button type="submit" className="button-primary" disabled={!renameProductName.trim() || productActionSubmitting}>
                        {m.save}
                      </button>
                      <button type="button" className="button-secondary" onClick={() => setRenamingProductId(null)}>
                        {m.cancel}
                      </button>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={p.id} className={p.active ? undefined : "catalog-row-inactive"}>
                  <td>{p.name}</td>
                  <td>{categoryLabel(p.categoryId)}</td>
                  <td className="amount">{formatCentsToBRL(p.priceCents)}</td>
                  <td>
                    <span className={`status-badge ${p.active ? "status-badge-success" : "status-badge-neutral"}`}>
                      {p.active ? m.active : m.inactive}
                    </span>
                  </td>
                  <td>
                    <span className="catalog-list-actions">
                      <button
                        type="button"
                        className="button-secondary row-action-button"
                        onClick={() => handleToggleActive(p.id, !p.active)}
                        aria-label={p.active ? m.deactivate : m.activate}
                        title={p.active ? m.deactivate : m.activate}
                      >
                        <PowerIcon />
                      </button>
                      <button
                        type="button"
                        className="button-secondary row-action-button"
                        onClick={() => handleStartRenameProduct(p.id, p.name)}
                        disabled={productActionSubmitting}
                        aria-label={m.rename}
                        title={m.rename}
                      >
                        <PencilIcon />
                      </button>
                      <button
                        type="button"
                        className="button-secondary row-action-button"
                        onClick={() => handleRemoveProduct(p.id)}
                        disabled={productActionSubmitting}
                        aria-label={m.remove}
                        title={m.remove}
                      >
                        <TrashIcon />
                      </button>
                    </span>
                  </td>
                </tr>
              )
            )}
            {products.length === 0 && (
              <tr>
                <td colSpan={5} className="catalog-empty">
                  {m.noProducts}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {productActionError && <p className="form-error" role="alert">{productActionError}</p>}
        </div>
      </div>
    </section>
  );
}

export default Catalog;

import { useEffect, useState } from "react";
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
import { useEstablishment, updateEstablishmentSettings } from "../lib/closing";

/** PRD Épico 3/M4 — cadastro de categorias e produtos (dono). PRD 5.1 — taxa de serviço padrão do estabelecimento. */
function Catalog() {
  const { status, categories, products, refresh } = useCatalog();
  const { status: establishmentStatus, defaultServiceFeePercent, refresh: refreshEstablishment } = useEstablishment();

  const [serviceFeePercent, setServiceFeePercent] = useState("10");
  const [serviceFeeError, setServiceFeeError] = useState<string | null>(null);
  const [serviceFeeSubmitting, setServiceFeeSubmitting] = useState(false);
  const [serviceFeeSaved, setServiceFeeSaved] = useState(false);

  useEffect(() => {
    if (establishmentStatus === "ready") setServiceFeePercent(String(defaultServiceFeePercent));
  }, [establishmentStatus, defaultServiceFeePercent]);

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

  async function handleSaveServiceFee(e: React.FormEvent) {
    e.preventDefault();
    const percent = Number(serviceFeePercent.replace(",", "."));
    if (!Number.isFinite(percent) || percent < 0 || serviceFeeSubmitting) return;
    setServiceFeeSubmitting(true);
    setServiceFeeError(null);
    setServiceFeeSaved(false);
    const result = await updateEstablishmentSettings(percent);
    setServiceFeeSubmitting(false);
    if (!result.ok) {
      setServiceFeeError(result.error);
      return;
    }
    setServiceFeeSaved(true);
    refreshEstablishment();
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
    <section>
      <div className="table-map-section">
        <h2>Configurações do estabelecimento</h2>
        <form onSubmit={handleSaveServiceFee} className="inline-form">
          <label>
            Taxa de serviço padrão (%)
            <input
              value={serviceFeePercent}
              onChange={(e) => {
                setServiceFeePercent(e.target.value.replace(/[^0-9,.]/g, ""));
                setServiceFeeSaved(false);
              }}
              inputMode="decimal"
            />
          </label>
          <button type="submit" className="button-primary" disabled={serviceFeeSubmitting}>
            Salvar
          </button>
        </form>
        {serviceFeeError && <p className="form-error">{serviceFeeError}</p>}
        {serviceFeeSaved && <p>Taxa de serviço padrão atualizada.</p>}
      </div>

      <div className="catalog">
        <div className="catalog-column">
        <h2>Categorias</h2>
        <form onSubmit={handleAddCategory} className="inline-form">
          <input
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            placeholder="Ex: Bebidas"
            aria-label="Nome da categoria"
          />
          <button type="submit" className="button-primary" disabled={!categoryName.trim() || categorySubmitting}>
            Adicionar
          </button>
        </form>
        {categoryError && <p className="form-error">{categoryError}</p>}
        <ul className="catalog-list">
          {categories.map((c) =>
            renamingCategoryId === c.id ? (
              <li key={c.id}>
                <form onSubmit={handleConfirmRenameCategory} className="inline-form">
                  <input
                    value={renameCategoryName}
                    onChange={(e) => setRenameCategoryName(e.target.value)}
                    aria-label="Novo nome da categoria"
                  />
                  <button type="submit" className="button-primary" disabled={!renameCategoryName.trim() || categoryActionSubmitting}>
                    Salvar
                  </button>
                  <button type="button" className="button-secondary" onClick={() => setRenamingCategoryId(null)}>
                    Cancelar
                  </button>
                </form>
              </li>
            ) : (
              <li key={c.id}>
                {c.name}{" "}
                <button type="button" className="button-secondary" onClick={() => handleStartRenameCategory(c.id, c.name)} disabled={categoryActionSubmitting}>
                  Renomear
                </button>{" "}
                <button type="button" className="button-secondary" onClick={() => handleRemoveCategory(c.id)} disabled={categoryActionSubmitting}>
                  Remover
                </button>
              </li>
            )
          )}
          {categories.length === 0 && <li className="catalog-empty">Nenhuma categoria ainda.</li>}
        </ul>
        {categoryActionError && <p className="form-error">{categoryActionError}</p>}
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
            className="button-primary"
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
            {products.map((p) =>
              renamingProductId === p.id ? (
                <tr key={p.id}>
                  <td colSpan={5}>
                    <form onSubmit={handleConfirmRenameProduct} className="inline-form">
                      <input
                        value={renameProductName}
                        onChange={(e) => setRenameProductName(e.target.value)}
                        aria-label="Novo nome do produto"
                      />
                      <button type="submit" className="button-primary" disabled={!renameProductName.trim() || productActionSubmitting}>
                        Salvar
                      </button>
                      <button type="button" className="button-secondary" onClick={() => setRenamingProductId(null)}>
                        Cancelar
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
                      {p.active ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td>
                    <button type="button" className="button-secondary" onClick={() => handleToggleActive(p.id, !p.active)}>
                      {p.active ? "Desativar" : "Ativar"}
                    </button>{" "}
                    <button type="button" className="button-secondary" onClick={() => handleStartRenameProduct(p.id, p.name)} disabled={productActionSubmitting}>
                      Renomear
                    </button>{" "}
                    <button type="button" className="button-secondary" onClick={() => handleRemoveProduct(p.id)} disabled={productActionSubmitting}>
                      Remover
                    </button>
                  </td>
                </tr>
              )
            )}
            {products.length === 0 && (
              <tr>
                <td colSpan={5} className="catalog-empty">
                  Nenhum produto ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {productActionError && <p className="form-error">{productActionError}</p>}
        </div>
      </div>
    </section>
  );
}

export default Catalog;

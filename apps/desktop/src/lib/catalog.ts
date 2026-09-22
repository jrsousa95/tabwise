import { useCallback, useEffect, useState } from "react";
import { SIDECAR_URL } from "./sidecar";

export type Category = { id: string; name: string };
export type Product = { id: string; name: string; priceCents: number; categoryId: string; active: boolean };

type CatalogStatus = "loading" | "ready";

/** PRD Épico 3/M4 — categorias e produtos, lidos da projeção (`GET /state`). */
export function useCatalog() {
  const [status, setStatus] = useState<CatalogStatus>("loading");
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${SIDECAR_URL}/state`);
      const data = (await res.json()) as Partial<{ categories: Category[]; products: Product[] }>;
      // Fallback pra [] se o sidecar rodando for de uma versão anterior a
      // esses campos existirem (não reinicia sozinho com HMR do frontend).
      setCategories(data.categories ?? []);
      setProducts(data.products ?? []);
    } catch {
      setCategories([]);
      setProducts([]);
    } finally {
      setStatus("ready");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, categories, products, refresh };
}

export async function createCategory(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`${SIDECAR_URL}/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? "não foi possível cadastrar a categoria" };
  }
  return { ok: true };
}

export async function createProduct(input: {
  name: string;
  priceCents: number;
  categoryId: string;
  active: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`${SIDECAR_URL}/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? "não foi possível cadastrar o produto" };
  }
  return { ok: true };
}

export async function setProductActive(productId: string, active: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`${SIDECAR_URL}/products/${productId}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? "não foi possível atualizar o produto" };
  }
  return { ok: true };
}

/** PRD 3.4 — renomear categoria já cadastrada. */
export async function renameCategory(categoryId: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`${SIDECAR_URL}/categories/${categoryId}/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? "não foi possível renomear a categoria" };
  }
  return { ok: true };
}

/** PRD 3.4 — remover categoria (lógico); 409 se houver produto vinculado (ativo ou inativo). */
export async function removeCategory(categoryId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`${SIDECAR_URL}/categories/${categoryId}`, { method: "DELETE" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? "não foi possível remover a categoria" };
  }
  return { ok: true };
}

/** PRD 3.5 — renomear produto já cadastrado; não afeta itens já lançados em comandas antigas. */
export async function renameProduct(productId: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`${SIDECAR_URL}/products/${productId}/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? "não foi possível renomear o produto" };
  }
  return { ok: true };
}

/** PRD 3.5 — remover produto (lógico, sem trava); comandas históricas continuam intactas. */
export async function removeProduct(productId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`${SIDECAR_URL}/products/${productId}`, { method: "DELETE" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? "não foi possível remover o produto" };
  }
  return { ok: true };
}

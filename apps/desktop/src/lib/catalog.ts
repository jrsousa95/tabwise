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
      const data = (await res.json()) as { categories: Category[]; products: Product[] };
      setCategories(data.categories);
      setProducts(data.products);
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

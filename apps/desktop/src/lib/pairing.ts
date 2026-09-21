import { useCallback, useEffect, useState } from "react";
import { SIDECAR_URL } from "./sidecar";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function getJson<T>(path: string): Promise<ApiResult<T>> {
  const res = await fetch(`${SIDECAR_URL}${path}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: (body as { error?: string } | null)?.error ?? "não foi possível carregar" };
  return { ok: true, data: body as T };
}

async function postJson<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  const res = await fetch(`${SIDECAR_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseBody = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, error: (responseBody as { error?: string } | null)?.error ?? "não foi possível completar a ação" };
  }
  return { ok: true, data: responseBody as T };
}

export type ManualHost = { host: string; port: number } | null;

/** M9 (ARCH §7) — token deste terminal, pra digitar em outro terminal na hora de parear. */
export function useLanToken() {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready">("loading");

  const refresh = useCallback(async () => {
    const result = await getJson<{ token: string }>("/pairing/lan-token");
    setToken(result.ok ? result.data.token : null);
    setStatus("ready");
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, token, refresh };
}

export function adoptLanToken(token: string) {
  return postJson<{ token: string }>("/pairing/lan-token", { token });
}

/** ARCH §2, decisão 2 — fallback manual de IP/porta pra quando a descoberta mDNS não acha o outro terminal. */
export function useManualHost() {
  const [manualHost, setManualHost] = useState<ManualHost>(null);
  const [status, setStatus] = useState<"loading" | "ready">("loading");

  const refresh = useCallback(async () => {
    const result = await getJson<ManualHost>("/pairing/manual-host");
    setManualHost(result.ok ? result.data : null);
    setStatus("ready");
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, manualHost, refresh };
}

export function saveManualHost(host: string, port: number) {
  return postJson<{ host: string; port: number }>("/pairing/manual-host", { host, port });
}

export async function clearManualHost(): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`${SIDECAR_URL}/pairing/manual-host`, { method: "DELETE" });
  if (!res.ok) return { ok: false, error: "não foi possível remover o host manual" };
  return { ok: true };
}

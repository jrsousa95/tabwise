import { useCallback, useEffect, useState } from "react";
import { SIDECAR_URL } from "./sidecar";

export type OperatorRole = "owner" | "cashier" | "waiter";

export type CurrentOperator = {
  id: string;
  name: string;
  role: OperatorRole;
};

type SessionStatus = "loading" | "ready";

/**
 * PRD 1.2 — sessão de terminal: persistida no sidecar até logout/troca de
 * operador, sem expiração automática. Este hook só espelha esse estado pra
 * UI; a fonte de verdade é o `session.json` do sidecar (sobrevive a
 * restart do app).
 */
export function useSession() {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [operator, setOperator] = useState<CurrentOperator | null>(null);

  // Achado em uso real, 2026-09-22: no cold start do app, esse fetch corria
  // antes do sidecar terminar de subir e escutar — falhava, e a versão
  // anterior marcava "ready" com operator=null mesmo assim, definitivo (sem
  // tentar de novo). `RequireSession` lia isso como "sem sessão" e
  // redirecionava pro login mesmo já existindo sessão válida persistida no
  // sidecar — só corrigia sozinho se o usuário navegasse pra outra tela e
  // voltasse. `refresh` continua uma tentativa única (nada externo depende
  // de retry embutido nela); quem tenta de novo é o efeito de montagem.
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${SIDECAR_URL}/session`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { operator: CurrentOperator | null };
      setOperator(data.operator);
      setStatus("ready");
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      const ok = await refresh();
      if (!ok && !cancelled) timer = setTimeout(load, 500);
    }

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);

  const login = useCallback(
    async (pin: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      const res = await fetch(`${SIDECAR_URL}/session/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        return { ok: false, error: body?.error ?? "não foi possível entrar" };
      }
      const data = (await res.json()) as CurrentOperator;
      setOperator(data);
      return { ok: true };
    },
    []
  );

  const logout = useCallback(async () => {
    await fetch(`${SIDECAR_URL}/session/logout`, { method: "POST" });
    setOperator(null);
  }, []);

  return { status, operator, login, logout, refresh };
}

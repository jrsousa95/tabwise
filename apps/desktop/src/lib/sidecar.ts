import { useEffect, useState } from "react";

export const SIDECAR_URL = "http://127.0.0.1:4550";

type SidecarHealth = {
  status: string;
  pid: number;
  startedAt: string;
  platform: string;
  arch: string;
};

/** Reaproveita o polling de /health validado no Spike 1 como indicador de conectividade na UI. */
export function useSidecarHealth(intervalMs = 2000) {
  const [health, setHealth] = useState<SidecarHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkSidecar() {
      try {
        const res = await fetch(`${SIDECAR_URL}/health`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SidecarHealth;
        if (!cancelled) {
          setHealth(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    checkSidecar();
    const interval = setInterval(checkSidecar, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [intervalMs]);

  return { health, error };
}

type IpcCheckStatus = "pending" | "ok" | "error";

/**
 * Critério de saída do M2 (implementation-plan.md): "uma tela React
 * consegue escrever e ler um evento de teste no SQLite local via IPC".
 * `insertEvent` é idempotente por id, então repetir esse POST em todo
 * reload não duplica nada no banco.
 */
export function useSidecarIpcCheck() {
  const [status, setStatus] = useState<IpcCheckStatus>("pending");

  useEffect(() => {
    let cancelled = false;

    async function verifyRoundtrip() {
      try {
        const testEvent = {
          id: "diagnostico-m2-ipc",
          hlc: "0000000000000000-0000",
          operatorId: "diagnostico-m2",
          terminalId: "diagnostico-m2",
          createdAt: 0,
          type: "operator_registered",
          aggregateType: "operator",
          aggregateId: "diagnostico-m2",
          payload: { name: "Diagnóstico M2", role: "owner", pinHash: "diagnostico-m2" },
        };

        const postRes = await fetch(`${SIDECAR_URL}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(testEvent),
        });
        if (!postRes.ok && postRes.status !== 400) throw new Error(`POST /events: HTTP ${postRes.status}`);

        const getRes = await fetch(`${SIDECAR_URL}/events`);
        if (!getRes.ok) throw new Error(`GET /events: HTTP ${getRes.status}`);
        const events = (await getRes.json()) as Array<{ id: string }>;
        const found = events.some((event) => event.id === testEvent.id);

        if (!cancelled) setStatus(found ? "ok" : "error");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    verifyRoundtrip();
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}

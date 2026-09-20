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

type IpcCheckStatus = "pendente" | "ok" | "erro";

/**
 * Critério de saída do M2 (implementation-plan.md): "uma tela React
 * consegue escrever e ler um evento de teste no SQLite local via IPC".
 * `inserirEvento` é idempotente por id, então repetir esse POST em todo
 * reload não duplica nada no banco.
 */
export function useSidecarIpcCheck() {
  const [status, setStatus] = useState<IpcCheckStatus>("pendente");

  useEffect(() => {
    let cancelled = false;

    async function verificarRoundtrip() {
      try {
        const eventoDeTeste = {
          id: "diagnostico-m2-ipc",
          hlc: "0000000000000000-0000",
          operadorId: "diagnostico-m2",
          terminalId: "diagnostico-m2",
          criadoEm: 0,
          tipo: "operador_cadastrado",
          aggregateType: "operador",
          aggregateId: "diagnostico-m2",
          payload: { nome: "Diagnóstico M2", papel: "dono", pinHash: "diagnostico-m2" },
        };

        const postRes = await fetch(`${SIDECAR_URL}/eventos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(eventoDeTeste),
        });
        if (!postRes.ok && postRes.status !== 400) throw new Error(`POST /eventos: HTTP ${postRes.status}`);

        const getRes = await fetch(`${SIDECAR_URL}/eventos`);
        if (!getRes.ok) throw new Error(`GET /eventos: HTTP ${getRes.status}`);
        const eventos = (await getRes.json()) as Array<{ id: string }>;
        const encontrado = eventos.some((evento) => evento.id === eventoDeTeste.id);

        if (!cancelled) setStatus(encontrado ? "ok" : "erro");
      } catch {
        if (!cancelled) setStatus("erro");
      }
    }

    verificarRoundtrip();
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}

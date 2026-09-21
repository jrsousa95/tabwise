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

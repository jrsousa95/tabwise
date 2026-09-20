import { useEffect, useState } from "react";
import "./App.css";

type SidecarHealth = {
  status: string;
  pid: number;
  startedAt: string;
  platform: string;
  arch: string;
};

/**
 * Tela do Spike 1 (M0): prova que o Tauri consegue subir o sidecar Node
 * (empacotado via SEA) e que o frontend consegue falar com ele via HTTP
 * local. Isso não é uma tela de produto — é só a validação da cadeia.
 */
function App() {
  const [health, setHealth] = useState<SidecarHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkSidecar() {
      try {
        const res = await fetch("http://127.0.0.1:4550/health");
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
    const interval = setInterval(checkSidecar, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <main className="container">
      <h1>Passa a Régua — Spike 1 (M0)</h1>
      <p>Validação: Tauri sobe o sidecar Node (SEA) e o frontend fala com ele via HTTP local.</p>

      {health ? (
        <div style={{ textAlign: "left", fontFamily: "monospace" }}>
          <p>✅ Sidecar respondendo</p>
          <ul>
            <li>status: {health.status}</li>
            <li>pid: {health.pid}</li>
            <li>startedAt: {health.startedAt}</li>
            <li>platform/arch: {health.platform}/{health.arch}</li>
          </ul>
        </div>
      ) : (
        <p>⏳ Aguardando resposta do sidecar{error ? ` — erro: ${error}` : "..."}</p>
      )}
    </main>
  );
}

export default App;

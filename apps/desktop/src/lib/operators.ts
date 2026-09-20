import { useEffect, useState } from "react";
import { SIDECAR_URL } from "./sidecar";
import type { CurrentOperator } from "./session";

type OperatorsStatus = "loading" | "ready";

/**
 * PRD 1.1/1.2 — usado pela tela de login pra decidir o fluxo: se ainda não
 * existe nenhum operador cadastrado neste terminal, mostra o cadastro do
 * primeiro dono em vez do teclado de PIN.
 */
export function useOperators() {
  const [status, setStatus] = useState<OperatorsStatus>("loading");
  const [operators, setOperators] = useState<CurrentOperator[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${SIDECAR_URL}/state`);
        const data = (await res.json()) as { operators: CurrentOperator[] };
        if (!cancelled) setOperators(data.operators);
      } catch {
        if (!cancelled) setOperators([]);
      } finally {
        if (!cancelled) setStatus("ready");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { status, operators };
}

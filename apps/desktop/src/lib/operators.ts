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
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      try {
        const res = await fetch(`${SIDECAR_URL}/state`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { operators: CurrentOperator[] };
        if (cancelled) return;
        setOperators(data.operators);
        setStatus("ready");
      } catch {
        // Achado em uso real, 2026-09-22: no cold start do app, esse fetch
        // corria antes do sidecar terminar de subir e escutar — falhava,
        // e a versão anterior marcava "ready" com 0 operadores mesmo
        // assim, definitivo (sem tentar de novo). A tela de Login lia isso
        // como "nenhum operador cadastrado" e mostrava o fluxo de
        // bootstrap mesmo já existindo dono cadastrado — só corrigia
        // sozinho se o usuário navegasse pra outra tela e voltasse
        // (remontando o hook depois do sidecar já estar de pé). Agora
        // tenta de novo em vez de desistir; `status` continua "loading"
        // (nunca "ready" com lista vazia por engano) até um fetch bem-sucedido.
        if (!cancelled) timer = setTimeout(load, 500);
      }
    }

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { status, operators };
}

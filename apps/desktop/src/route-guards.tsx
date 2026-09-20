import { Navigate, Outlet } from "react-router-dom";
import { useSession } from "./lib/session";
import type { OperatorRole } from "./lib/session";

/** PRD 1.2 — sem sessão ativa, qualquer rota de produto volta pro login. */
export function RequireSession() {
  const { status, operator } = useSession();

  if (status === "loading") return null;
  if (!operator) return <Navigate to="/" replace />;

  return <Outlet />;
}

/**
 * PRD §2 (permissões por papel) — bloqueia navegação pra quem não tem o
 * papel exigido. Enforcement é só de navegação (UI), não uma camada de
 * autorização de servidor completa — a revisão de segurança fica pro M12.
 */
export function RequireRole({ allowed }: { allowed: readonly OperatorRole[] }) {
  const { status, operator } = useSession();

  if (status === "loading") return null;
  if (!operator) return <Navigate to="/" replace />;
  if (!allowed.includes(operator.role)) return <Navigate to="/tables" replace />;

  return <Outlet />;
}

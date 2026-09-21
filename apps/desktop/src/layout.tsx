import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useSidecarHealth, useSidecarIpcCheck } from "./lib/sidecar";
import { useSession } from "./lib/session";

const navLinkClassName = ({ isActive }: { isActive: boolean }) => (isActive ? "nav-link nav-link-active" : "nav-link");

const roleLabel: Record<string, string> = { owner: "dono", cashier: "caixa", waiter: "garçom" };

/**
 * Shell navegável do M2/M3 (implementation-plan.md) — nav com permissões
 * por papel (PRD §2): garçom não vê o link de Caixa; só o dono vê o link
 * de cadastro de operador.
 */
function Layout() {
  const { health, error } = useSidecarHealth();
  const ipcCheck = useSidecarIpcCheck();
  const { operator, logout } = useSession();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/");
  }

  return (
    <div className="app-shell">
      <header className="app-nav">
        <span className="app-nav-brand">Passa a Régua</span>
        <nav>
          <NavLink to="/tables" className={navLinkClassName}>
            Mapa de Mesas
          </NavLink>
          {(operator?.role === "owner" || operator?.role === "cashier") && (
            <NavLink to="/cash-register" className={navLinkClassName}>
              Caixa
            </NavLink>
          )}
          {operator?.role === "owner" && (
            <NavLink to="/catalog" className={navLinkClassName}>
              Cardápio
            </NavLink>
          )}
          {operator?.role === "owner" && (
            <NavLink to="/operators/new" className={navLinkClassName}>
              Cadastrar operador
            </NavLink>
          )}
        </nav>
        {operator && (
          <span className="current-operator">
            {operator.name} ({roleLabel[operator.role] ?? operator.role})
            <button type="button" className="logout-button" onClick={handleLogout}>
              Sair
            </button>
          </span>
        )}
        <span className={`sidecar-status ${health ? "sidecar-status-ok" : "sidecar-status-down"}`}>
          {health ? "sidecar ok" : `sidecar offline${error ? ` (${error})` : ""}`}
        </span>
        <span className={`sidecar-status sidecar-status-${ipcCheck === "ok" ? "ok" : ipcCheck === "error" ? "down" : "pending"}`}>
          {ipcCheck === "ok" ? "IPC ok" : ipcCheck === "error" ? "IPC falhou" : "IPC..."}
        </span>
      </header>
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;

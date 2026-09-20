import { NavLink, Outlet } from "react-router-dom";
import { useSidecarHealth, useSidecarIpcCheck } from "./lib/sidecar";

const navLinkClassName = ({ isActive }: { isActive: boolean }) => (isActive ? "nav-link nav-link-active" : "nav-link");

/**
 * Shell navegável do M2 (implementation-plan.md) — só a casca das telas,
 * sem lógica de negócio (isso entra épico por épico a partir do M3).
 */
function Layout() {
  const { health, error } = useSidecarHealth();
  const ipcCheck = useSidecarIpcCheck();

  return (
    <div className="app-shell">
      <header className="app-nav">
        <span className="app-nav-brand">Passa a Régua</span>
        <nav>
          <NavLink to="/tables" className={navLinkClassName}>
            Mapa de Mesas
          </NavLink>
          <NavLink to="/cash-register" className={navLinkClassName}>
            Caixa
          </NavLink>
        </nav>
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

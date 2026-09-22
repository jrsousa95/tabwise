import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useSidecarHealth } from "./lib/sidecar";
import { useSession } from "./lib/session";
import { useMergeWarnings } from "./lib/merge-warnings";

const navLinkClassName = ({ isActive }: { isActive: boolean }) => (isActive ? "nav-link nav-link-active" : "nav-link");

const roleLabel: Record<string, string> = { owner: "dono", cashier: "caixa", waiter: "garçom" };

/**
 * Shell navegável do M2/M3 (implementation-plan.md) — nav com permissões
 * por papel (PRD §2): garçom não vê o link de Caixa; só o dono vê o link
 * de cadastro de operador.
 */
function Layout() {
  const { health, error } = useSidecarHealth();
  const { operator, logout } = useSession();
  const navigate = useNavigate();
  const { warnings: mergeWarnings, tableLabel } = useMergeWarnings();
  const [showMergeDetails, setShowMergeDetails] = useState(false);

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
          {operator?.role === "owner" && (
            <NavLink to="/pairing" className={navLinkClassName}>
              Pareamento
            </NavLink>
          )}
        </nav>
        {operator && (
          <span className="current-operator">
            {operator.name} ({roleLabel[operator.role] ?? operator.role})
            <button type="button" className="logout-button button-secondary" onClick={handleLogout}>
              Sair
            </button>
          </span>
        )}
        <span className={`sidecar-status ${health ? "sidecar-status-ok" : "sidecar-status-down"}`}>
          {health ? "sidecar ok" : `sidecar offline${error ? ` (${error})` : ""}`}
        </span>
      </header>
      {mergeWarnings.length > 0 && (
        // ARCH §4.2 — merge automático de comanda (conflito entre terminais
        // offline resolvido por menor HLC) nunca deve passar em silêncio;
        // é só um aviso, não bloqueia nenhuma ação.
        <div className="merge-warning-banner">
          <span>
            ⚠️ {mergeWarnings.length} {mergeWarnings.length === 1 ? "comanda foi mesclada" : "comandas foram mescladas"}{" "}
            automaticamente por conflito de sincronização.
          </span>
          <button type="button" className="button-secondary" onClick={() => setShowMergeDetails((v) => !v)}>
            {showMergeDetails ? "Ocultar detalhes" : "Ver detalhes"}
          </button>
          {showMergeDetails && (
            <ul>
              {mergeWarnings.map((w) => (
                <li key={w.losingOrder}>
                  {tableLabel(w.tableId)}: a comanda mais nova foi mesclada na comanda existente — os itens
                  lançados nela agora aparecem na comanda que ficou aberta.
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;

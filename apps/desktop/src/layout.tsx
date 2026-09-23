import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useSidecarHealth } from "./lib/sidecar";
import { useSession } from "./lib/session";
import { useMergeWarnings } from "./lib/merge-warnings";

const navLinkClassName = ({ isActive }: { isActive: boolean }) => (isActive ? "nav-link nav-link-active" : "nav-link");

const roleLabel: Record<string, string> = { owner: "dono", cashier: "caixa", waiter: "garçom" };

/* Ícones inline (mesmo padrão de table-map.tsx/order.tsx: SVG,
   stroke=currentColor, sem preenchimento, 20×20, aria-hidden porque o
   nome acessível vive no aria-label do botão). */
function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

/**
 * Shell navegável do M2/M3 (implementation-plan.md) — nav com permissões
 * por papel (PRD §2): garçom não vê o link de Caixa; só o dono vê o link
 * de cadastro de operador.
 *
 * Achado em uso real, 2026-09-23: com 6 itens (dono), o header não cabia
 * mais numa linha só a partir de ~1024px pra baixo e quebrava de forma
 * bagunçada. Abaixo de 1024px (`.nav-toggle`/`.app-nav nav` em app.css)
 * o menu vira um botão ☰ que revela os links empilhados — só afeta o
 * dono, que é quem tem os 6 itens; garçom (1 item) e caixa (2 itens)
 * nunca acionam o wrap nem veem o botão, já que sempre cabem numa linha.
 */
function Layout() {
  const { health, error } = useSidecarHealth();
  const { operator, logout } = useSession();
  const navigate = useNavigate();
  const { warnings: mergeWarnings, tableLabel, dismiss } = useMergeWarnings();
  const [showMergeDetails, setShowMergeDetails] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Fecha o menu ao clicar fora dele ou apertar Esc — mesmo padrão de
  // qualquer menu suspenso; só ativo enquanto `navOpen` (sem listener
  // pendurado o tempo todo à toa).
  useEffect(() => {
    if (!navOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (navRef.current?.contains(e.target as Node) || toggleRef.current?.contains(e.target as Node)) return;
      setNavOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setNavOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [navOpen]);

  async function handleLogout() {
    await logout();
    navigate("/");
  }

  return (
    <div className="app-shell">
      <header className="app-nav">
        <span className="app-nav-brand brand-wordmark">Passa a Régua</span>
        <button
          type="button"
          ref={toggleRef}
          className="nav-toggle button-secondary"
          aria-label={navOpen ? "Fechar menu" : "Abrir menu"}
          aria-expanded={navOpen}
          aria-controls="app-nav-menu"
          onClick={() => setNavOpen((v) => !v)}
        >
          {navOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
        <nav id="app-nav-menu" ref={navRef} className={navOpen ? "nav-open" : undefined}>
          <NavLink to="/tables" className={navLinkClassName} onClick={() => setNavOpen(false)}>
            Mapa de Mesas
          </NavLink>
          {(operator?.role === "owner" || operator?.role === "cashier") && (
            <NavLink to="/cash-register" className={navLinkClassName} onClick={() => setNavOpen(false)}>
              Caixa
            </NavLink>
          )}
          {operator?.role === "owner" && (
            <NavLink to="/catalog" className={navLinkClassName} onClick={() => setNavOpen(false)}>
              Cardápio
            </NavLink>
          )}
          {operator?.role === "owner" && (
            <NavLink to="/settings" className={navLinkClassName} onClick={() => setNavOpen(false)}>
              Configurações
            </NavLink>
          )}
          {operator?.role === "owner" && (
            <NavLink to="/table-conflicts" className={navLinkClassName} onClick={() => setNavOpen(false)}>
              Conflitos de Mesas
            </NavLink>
          )}
          {operator?.role === "owner" && (
            <NavLink to="/operators/new" className={navLinkClassName} onClick={() => setNavOpen(false)}>
              Cadastrar operador
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
        {/* Achado em uso real, 2026-09-22: "sidecar ok"/"sidecar offline" é
            jargão técnico interno (o dono do estabelecimento não tem por
            que saber o que é "sidecar") — texto visível vira linguagem
            leiga; o detalhe técnico (erro cru) fica só no tooltip, pra
            quando alguém for debugar. */}
        <span
          className={`status-badge ${health ? "status-badge-success" : "status-badge-danger"}`}
          title={!health && error ? error : undefined}
        >
          {health ? "Conectado" : "Sem conexão"}
        </span>
      </header>
      {mergeWarnings.length > 0 && (
        // ARCH §4.2 — merge automático de comanda (conflito entre terminais
        // offline resolvido por menor HLC) nunca deve passar em silêncio;
        // é só um aviso, não bloqueia nenhuma ação. role="status" (achado
        // na validação de acessibilidade, 2026-09-23): mesmo padrão já
        // usado em pairing.tsx, faltava aqui — sem isso, um leitor de tela
        // só descobre o aviso se o operador navegar manualmente até o topo.
        <div className="merge-warning-banner" role="status">
          <span>
            ⚠️ {mergeWarnings.length} {mergeWarnings.length === 1 ? "comanda foi mesclada" : "comandas foram mescladas"}{" "}
            automaticamente por conflito de sincronização.
          </span>
          <button type="button" className="button-secondary" onClick={() => setShowMergeDetails((v) => !v)}>
            {showMergeDetails ? "Ocultar detalhes" : "Ver detalhes"}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => mergeWarnings.forEach((w) => dismiss(w.losingOrder))}
          >
            Dispensar tudo
          </button>
          {/* ARCH §4.2 — este banner é só a notificação transitória (recente,
              dispensável); o registro permanente "visível ao dono", com a
              ação de marcar como resolvido, fica na tela de Conflitos de
              Mesas — link só pro dono, já que a rota é owner-only. */}
          {operator?.role === "owner" && (
            <a href="#/table-conflicts" className="button-secondary">
              Ver histórico completo
            </a>
          )}
          {showMergeDetails && (
            <ul>
              {mergeWarnings.map((w) => (
                <li key={w.losingOrder}>
                  {tableLabel(w.tableId)}: a comanda mais nova foi mesclada na comanda existente — os itens
                  lançados nela agora aparecem na comanda que ficou aberta.{" "}
                  <button type="button" className="button-secondary" onClick={() => dismiss(w.losingOrder)}>
                    Dispensar
                  </button>
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

import { useState } from "react";
import { Link } from "react-router-dom";
import { useOperators } from "../lib/operators";
import { useSession } from "../lib/session";
import { useLanToken, adoptLanToken, useManualHost, saveManualHost, clearManualHost, useCloudStatus } from "../lib/pairing";

/**
 * M9 (ARCH §2, §7) — tela de Pareamento. Mesmo padrão de dois modos de
 * `operator-registration.tsx`: bootstrap (terminal novo, zero operadores,
 * sem ninguém logado — só adota um token de outro terminal) e uso normal
 * (dono já logado, vê o próprio token pra passar pra um terminal novo e
 * configura o fallback manual de IP/porta).
 */
function Pairing() {
  const { operators, status: operatorsStatus } = useOperators();
  const { operator: currentOperator, status: sessionStatus } = useSession();
  const isBootstrap = operatorsStatus === "ready" && operators.length === 0;
  const loading = operatorsStatus === "loading" || sessionStatus === "loading";

  const { status: tokenStatus, token, refresh: refreshToken } = useLanToken();
  const { status: manualHostStatus, manualHost, refresh: refreshManualHost } = useManualHost();
  const cloudStatus = useCloudStatus();

  const [adoptInput, setAdoptInput] = useState("");
  const [adoptError, setAdoptError] = useState<string | null>(null);
  const [adoptSuccess, setAdoptSuccess] = useState(false);
  const [adoptSubmitting, setAdoptSubmitting] = useState(false);

  const [manualHostInput, setManualHostInput] = useState("");
  const [manualPortInput, setManualPortInput] = useState("");
  const [manualHostError, setManualHostError] = useState<string | null>(null);
  const [manualHostSubmitting, setManualHostSubmitting] = useState(false);

  const [copied, setCopied] = useState(false);

  async function handleAdopt(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = adoptInput.trim();
    if (!trimmed || adoptSubmitting) return;
    setAdoptSubmitting(true);
    setAdoptError(null);
    setAdoptSuccess(false);
    const result = await adoptLanToken(trimmed);
    setAdoptSubmitting(false);
    if (!result.ok) {
      setAdoptError(result.error);
      return;
    }
    setAdoptSuccess(true);
    setAdoptInput("");
    refreshToken();
  }

  async function handleCopyToken() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard pode não estar disponível (permissão negada, contexto sem HTTPS); o token já está visível na tela.
    }
  }

  async function handleSaveManualHost(e: React.FormEvent) {
    e.preventDefault();
    const host = manualHostInput.trim();
    const port = Number(manualPortInput);
    if (!host || !Number.isInteger(port) || port <= 0 || manualHostSubmitting) return;
    setManualHostSubmitting(true);
    setManualHostError(null);
    const result = await saveManualHost(host, port);
    setManualHostSubmitting(false);
    if (!result.ok) {
      setManualHostError(result.error);
      return;
    }
    setManualHostInput("");
    setManualPortInput("");
    refreshManualHost();
  }

  async function handleClearManualHost() {
    setManualHostSubmitting(true);
    await clearManualHost();
    setManualHostSubmitting(false);
    refreshManualHost();
  }

  if (loading) {
    return (
      <main className="container">
        <p>Carregando...</p>
      </main>
    );
  }

  if (!isBootstrap && !currentOperator) {
    return (
      <main className="container">
        <p>Faça login antes de acessar o pareamento.</p>
      </main>
    );
  }

  if (!isBootstrap && currentOperator?.role !== "owner") {
    return (
      <main className="container">
        <p>Só o dono pode configurar o pareamento entre terminais.</p>
      </main>
    );
  }

  return (
    <main className="container">
      {/* Achado em uso real (2026-09-22): esta rota fica fora do shell
          autenticado (sem menu de navegação) — sem este link, o dono ficava
          sem nenhuma forma de sair da tela fora do modo bootstrap. Aponta
          pra Configurações (não mais Mapa de Mesas) porque é de lá que o
          dono chega aqui agora — Pareamento saiu do menu principal e virou
          um link dentro de Configurações (mesmo achado, 2026-09-22). */}
      {!isBootstrap && (
        <div className="operator-form-actions">
          <Link to="/settings" className="button-secondary">
            ← Voltar às configurações
          </Link>
        </div>
      )}
      <h1>Pareamento de terminais</h1>

      {/* M10 (PRD 8.1) — mensagem clara de upgrade quando o plano bloqueou
          este terminal na nuvem; sem isso o bloqueio ficaria silencioso
          (o terminal continua funcionando localmente, só não sincroniza). */}
      {cloudStatus?.blockedReason && (
        <p className="status-line" role="status">
          <span className="status-badge status-badge-danger">bloqueado</span>
          {cloudStatus.blockedReason}
        </p>
      )}
      {cloudStatus && !cloudStatus.blockedReason && (
        <p className="status-line" role="status">
          <span className={`status-badge ${cloudStatus.connected ? "status-badge-success" : "status-badge-neutral"}`}>
            {cloudStatus.connected ? "conectado" : "conectando..."}
          </span>
          {cloudStatus.connected ? "Conectado à nuvem." : "Ainda não conectado à nuvem — tentando..."}
        </p>
      )}

      {isBootstrap && (
        <p>
          Este terminal ainda não tem nenhum operador. Digite abaixo o código de pareamento de um terminal já
          configurado pra sincronizar (mesas, cardápio, operadores) em vez de cadastrar tudo de novo.
        </p>
      )}

      <div className="table-map-section">
        <h2>Adotar código de outro terminal</h2>
        <form onSubmit={handleAdopt} className="inline-form">
          <input
            value={adoptInput}
            onChange={(e) => setAdoptInput(e.target.value)}
            placeholder="Código lido no outro terminal"
            aria-label="Código de pareamento"
          />
          <button type="submit" className="button-primary" disabled={!adoptInput.trim() || adoptSubmitting}>
            Adotar
          </button>
        </form>
        {adoptError && <p className="form-error">{adoptError}</p>}
        {adoptSuccess && <p>Código adotado — a sincronização com o outro terminal começa no próximo ciclo (a cada 5s).</p>}
      </div>

      {!isBootstrap && (
        <div className="table-map-section">
          <h2>Código deste terminal</h2>
          <p>Leia este código em um terminal novo pra pareá-lo com este (ele vai adotar todos os dados já cadastrados aqui).</p>
          {tokenStatus === "loading" && <p>Carregando...</p>}
          {token && (
            <div className="status-line pairing-token">
              <code>{token}</code>
              <button type="button" className="button-secondary" onClick={handleCopyToken}>
                {copied ? "Copiado!" : "Copiar"}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="table-map-section">
        <h2>Host manual (fallback)</h2>
        <p>
          Os terminais se acham sozinhos na rede automaticamente (mDNS). Se isso falhar (rede corporativa que bloqueia
          multicast, por exemplo), configure aqui o IP e a porta do outro terminal manualmente.
        </p>
        {manualHostStatus === "ready" && manualHost && (
          <div className="status-line pairing-token">
            <span>Configurado:</span>
            <code>{manualHost.host}:{manualHost.port}</code>
            <button type="button" className="button-secondary" onClick={handleClearManualHost} disabled={manualHostSubmitting}>
              Remover
            </button>
          </div>
        )}
        <form onSubmit={handleSaveManualHost} className="inline-form">
          <input value={manualHostInput} onChange={(e) => setManualHostInput(e.target.value)} placeholder="IP (ex: 192.168.1.10)" />
          <input
            value={manualPortInput}
            onChange={(e) => setManualPortInput(e.target.value.replace(/\D/g, ""))}
            placeholder="Porta (ex: 4550)"
            inputMode="numeric"
          />
          <button type="submit" className="button-primary" disabled={!manualHostInput.trim() || !manualPortInput || manualHostSubmitting}>
            Salvar
          </button>
        </form>
        {manualHostError && <p className="form-error">{manualHostError}</p>}
      </div>

      {isBootstrap && (
        <div className="operator-form-actions">
          <Link to="/" className="button-secondary">
            ← Voltar
          </Link>
        </div>
      )}
    </main>
  );
}

export default Pairing;

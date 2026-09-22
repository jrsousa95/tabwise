import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { SIDECAR_URL } from "../lib/sidecar";
import { useOperators } from "../lib/operators";
import { useSession } from "../lib/session";
import type { OperatorRole } from "../lib/session";

/**
 * PRD 1.1 — cadastro de operador. Serve dois casos com a mesma tela:
 * bootstrap (nenhum operador existe ainda, ninguém logado — qualquer um
 * pode criar o primeiro dono) e uso normal (dono logado cadastra mais
 * gente). O sidecar decide no backend qual caso vale (ver `POST /operators`
 * em `apps/desktop/sidecar/src/index.ts`).
 */
function OperatorRegistration() {
  const navigate = useNavigate();
  const { operators, status: operatorsStatus } = useOperators();
  const { operator: currentOperator, status: sessionStatus } = useSession();
  const isBootstrap = operatorsStatus === "ready" && operators.length === 0;
  const loading = operatorsStatus === "loading" || sessionStatus === "loading";

  const [name, setName] = useState("");
  const [selectedRole, setSelectedRole] = useState<OperatorRole>("waiter");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // No bootstrap o papel é sempre "dono" (não dá pra derivar isso só no
  // estado inicial do useState: `isBootstrap` ainda é falso no primeiro
  // render, porque `operatorsStatus` começa em "loading").
  const role: OperatorRole = isBootstrap ? "owner" : selectedRole;

  const pinValid = /^\d{4,6}$/.test(pin);
  const canSubmit = name.trim().length > 0 && pinValid && pin === pinConfirm && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${SIDECAR_URL}/operators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), role, pin }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "não foi possível cadastrar");
        return;
      }
      navigate(isBootstrap ? "/" : "/tables");
    } finally {
      setSubmitting(false);
    }
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
        <p>Faça login antes de cadastrar operadores.</p>
      </main>
    );
  }

  if (!isBootstrap && currentOperator?.role !== "owner") {
    return (
      <main className="container">
        <p>Só o dono pode cadastrar operadores.</p>
      </main>
    );
  }

  return (
    <main className="container">
      <h1>{isBootstrap ? "Cadastrar o primeiro operador" : "Cadastrar operador"}</h1>
      {isBootstrap && <p>Nenhum operador cadastrado neste terminal ainda — comece criando o dono.</p>}

      <form onSubmit={handleSubmit} className="operator-form">
        <label>
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>

        <label>
          Papel
          <select value={role} onChange={(e) => setSelectedRole(e.target.value as OperatorRole)} disabled={isBootstrap}>
            <option value="owner">Dono</option>
            <option value="cashier">Caixa</option>
            <option value="waiter">Garçom</option>
          </select>
        </label>

        <label>
          PIN (4 a 6 dígitos)
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        </label>

        <label>
          Confirmar PIN
          <input
            type="password"
            inputMode="numeric"
            value={pinConfirm}
            onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        </label>

        {pin.length > 0 && !pinValid && <p className="form-error">PIN precisa ter de 4 a 6 dígitos.</p>}
        {pinConfirm.length > 0 && pin !== pinConfirm && <p className="form-error">Os PINs não coincidem.</p>}
        {error && <p className="form-error">{error}</p>}

        <div className="operator-form-actions">
          <button type="submit" className="button-primary" disabled={!canSubmit}>
            Cadastrar
          </button>
          {/* No bootstrap não tem pra onde voltar — sem operador nenhum,
              o app não tem mais nada pra mostrar (PRD 1.1). */}
          {!isBootstrap && (
            <Link to="/tables" className="button-secondary">
              Cancelar
            </Link>
          )}
        </div>
      </form>
    </main>
  );
}

export default OperatorRegistration;

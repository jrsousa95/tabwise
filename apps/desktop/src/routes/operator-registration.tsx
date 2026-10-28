import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { SIDECAR_URL } from "../lib/sidecar";
import { useOperators } from "../lib/operators";
import { useSession } from "../lib/session";
import type { OperatorRole } from "../lib/session";
import { defineMessages, useMessages } from "../lib/i18n";
import { localizeError } from "../lib/server-errors";
import LanguageToggle from "../language-toggle";

const messages = defineMessages({
  pt: {
    registerFailed: "não foi possível cadastrar",
    loading: "Carregando...",
    loginRequired: "Faça login antes de cadastrar operadores.",
    ownerOnly: "Só o dono pode cadastrar operadores.",
    titleFirstOperator: "Cadastrar o primeiro operador",
    titleRegisterOperator: "Cadastrar operador",
    bootstrapHint: "Nenhum operador cadastrado neste terminal ainda — comece criando o dono.",
    name: "Nome",
    role: "Papel",
    roleOwner: "Dono",
    roleCashier: "Caixa",
    roleWaiter: "Garçom",
    pinLabel: "PIN (4 a 6 dígitos)",
    confirmPin: "Confirmar PIN",
    pinInvalid: "PIN precisa ter de 4 a 6 dígitos.",
    pinMismatch: "Os PINs não coincidem.",
    submit: "Cadastrar",
    cancel: "Cancelar",
  },
  en: {
    registerFailed: "couldn't add staff member",
    loading: "Loading...",
    loginRequired: "Log in before adding staff members.",
    ownerOnly: "Only the owner can add staff members.",
    titleFirstOperator: "Add the first staff member",
    titleRegisterOperator: "Add staff member",
    bootstrapHint: "No staff members registered on this terminal yet — start by creating the owner.",
    name: "Name",
    role: "Role",
    roleOwner: "Owner",
    roleCashier: "Cashier",
    roleWaiter: "Server",
    pinLabel: "PIN (4 to 6 digits)",
    confirmPin: "Confirm PIN",
    pinInvalid: "PIN must be 4 to 6 digits.",
    pinMismatch: "PINs don't match.",
    submit: "Add",
    cancel: "Cancel",
  },
});

/**
 * PRD 1.1 — cadastro de operador. Serve dois casos com a mesma tela:
 * bootstrap (nenhum operador existe ainda, ninguém logado — qualquer um
 * pode criar o primeiro dono) e uso normal (dono logado cadastra mais
 * gente). O sidecar decide no backend qual caso vale (ver `POST /operators`
 * em `apps/desktop/sidecar/src/index.ts`).
 */
function OperatorRegistration() {
  const navigate = useNavigate();
  const m = useMessages(messages);
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
        setError(body?.error ? localizeError(body.error) : m.registerFailed);
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
        <LanguageToggle floating />
        <p>{m.loading}</p>
      </main>
    );
  }

  if (!isBootstrap && !currentOperator) {
    return (
      <main className="container">
        <LanguageToggle floating />
        <p>{m.loginRequired}</p>
      </main>
    );
  }

  if (!isBootstrap && currentOperator?.role !== "owner") {
    return (
      <main className="container">
        <LanguageToggle floating />
        <p>{m.ownerOnly}</p>
      </main>
    );
  }

  return (
    <main className="container">
      <LanguageToggle floating />
      <h1>{isBootstrap ? m.titleFirstOperator : m.titleRegisterOperator}</h1>
      {isBootstrap && <p>{m.bootstrapHint}</p>}

      <form onSubmit={handleSubmit} className="operator-form">
        <label>
          {m.name}
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>

        <label>
          {m.role}
          <select value={role} onChange={(e) => setSelectedRole(e.target.value as OperatorRole)} disabled={isBootstrap}>
            <option value="owner">{m.roleOwner}</option>
            <option value="cashier">{m.roleCashier}</option>
            <option value="waiter">{m.roleWaiter}</option>
          </select>
        </label>

        <label>
          {m.pinLabel}
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        </label>

        <label>
          {m.confirmPin}
          <input
            type="password"
            inputMode="numeric"
            value={pinConfirm}
            onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        </label>

        {pin.length > 0 && !pinValid && <p className="form-error" role="alert">{m.pinInvalid}</p>}
        {pinConfirm.length > 0 && pin !== pinConfirm && <p className="form-error" role="alert">{m.pinMismatch}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="operator-form-actions">
          <button type="submit" className="button-primary" disabled={!canSubmit}>
            {m.submit}
          </button>
          {/* No bootstrap não tem pra onde voltar — sem operador nenhum,
              o app não tem mais nada pra mostrar (PRD 1.1). */}
          {!isBootstrap && (
            <Link to="/tables" className="button-secondary">
              {m.cancel}
            </Link>
          )}
        </div>
      </form>
    </main>
  );
}

export default OperatorRegistration;

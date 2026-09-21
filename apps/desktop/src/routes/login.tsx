import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useOperators } from "../lib/operators";
import { useSession } from "../lib/session";

const PIN_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9, "⌫", 0, "OK"] as const;

/** PRD 1.2 — login por PIN, 100% offline (validado contra a réplica local no sidecar). */
function Login() {
  const navigate = useNavigate();
  const { operators, status: operatorsStatus } = useOperators();
  const { login } = useSession();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (operatorsStatus === "loading") {
    return (
      <main className="container">
        <p>Carregando...</p>
      </main>
    );
  }

  if (operators.length === 0) {
    return (
      <main className="container">
        <h1>Passa a Régua</h1>
        <p>Nenhum operador cadastrado neste terminal ainda.</p>
        <Link to="/operators/new">Cadastrar o primeiro operador →</Link>
        {/* M9 (ARCH §7) — terminal novo pode virar réplica de um já existente
            em vez de bootstrar operadores do zero: adota o token do terminal
            1, sincroniza e recebe os operadores dele. */}
        <p>
          <Link to="/pairing">Ou parear com um terminal já configurado →</Link>
        </p>
      </main>
    );
  }

  async function submitPin(candidatePin: string) {
    if (candidatePin.length < 4 || submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await login(candidatePin);
    setSubmitting(false);
    if (result.ok) {
      navigate("/tables");
    } else {
      setError(result.error);
      setPin("");
    }
  }

  function handleKey(key: (typeof PIN_DIGITS)[number]) {
    if (key === "⌫") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (key === "OK") {
      submitPin(pin);
      return;
    }
    setPin((p) => (p.length < 6 ? p + key : p));
  }

  return (
    <main className="container">
      <h1>Passa a Régua</h1>
      <p>Digite seu PIN</p>
      <div className="pin-display" aria-live="polite">
        {"•".repeat(pin.length) || " "}
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="pin-pad">
        {PIN_DIGITS.map((key) => (
          <button key={key} type="button" disabled={submitting} onClick={() => handleKey(key)}>
            {key}
          </button>
        ))}
      </div>
    </main>
  );
}

export default Login;

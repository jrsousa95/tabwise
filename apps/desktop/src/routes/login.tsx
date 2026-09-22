import { useEffect, useState } from "react";
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

  // Achado em uso real, 2026-09-22: só dava pra digitar o PIN clicando no
  // teclado numérico na tela — teclado físico (dígitos, Backspace, Enter)
  // é bem mais rápido num terminal de verdade. Precisa ficar antes dos
  // `return` condicionais abaixo (Rules of Hooks: hooks não podem ser
  // condicionais); só reage de fato quando a tela normal de PIN está
  // visível (não durante loading nem no bootstrap sem operador).
  useEffect(() => {
    if (operatorsStatus !== "ready" || operators.length === 0) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (submitting) return;
      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        handleKey(Number(e.key) as (typeof PIN_DIGITS)[number]);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        handleKey("⌫");
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleKey("OK");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operatorsStatus, operators.length, pin, submitting]);

  if (operatorsStatus === "loading") {
    return (
      <main className="container container-center">
        <p>Carregando...</p>
      </main>
    );
  }

  if (operators.length === 0) {
    return (
      <main className="container container-center">
        <h1 className="brand-wordmark brand-wordmark-lg">Passa a Régua</h1>
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
    <main className="container container-center">
      <h1 className="brand-wordmark brand-wordmark-lg">Passa a Régua</h1>
      <p>Digite seu PIN</p>
      <div className="pin-display" aria-live="polite">
        {"•".repeat(pin.length) || " "}
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="pin-pad">
        {PIN_DIGITS.map((key) => (
          <button key={key} type="button" className="pin-key" disabled={submitting} onClick={() => handleKey(key)}>
            {key}
          </button>
        ))}
      </div>
    </main>
  );
}

export default Login;

import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useOperators } from "../lib/operators";
import { useSession } from "../lib/session";
import { MULTI_TERMINAL_UI_ENABLED } from "../lib/feature-flags";
import { defineMessages, useMessages } from "../lib/i18n";
import LanguageToggle from "../language-toggle";

const PIN_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9, "⌫", 0, "OK"] as const;

const messages = defineMessages({
  pt: {
    loading: "Carregando...",
    noOperators: "Nenhum operador cadastrado neste terminal ainda.",
    registerFirstOperator: "Cadastrar o primeiro operador →",
    pairWithTerminal: "Ou parear com um terminal já configurado →",
    enterPin: "Digite seu PIN",
    backspace: "Apagar",
    confirm: "Confirmar",
  },
  en: {
    loading: "Loading...",
    noOperators: "No staff members registered on this terminal yet.",
    registerFirstOperator: "Add the first staff member →",
    pairWithTerminal: "Or pair with a terminal that's already set up →",
    enterPin: "Enter your PIN",
    backspace: "Delete",
    confirm: "Confirm",
  },
});

/** PRD 1.2 — login por PIN, 100% offline (validado contra a réplica local no sidecar). */
function Login() {
  const navigate = useNavigate();
  const m = useMessages(messages);
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
        <LanguageToggle floating />
        <p>{m.loading}</p>
      </main>
    );
  }

  if (operators.length === 0) {
    return (
      <main className="container container-center">
        <LanguageToggle floating />
        <h1 className="brand-wordmark brand-wordmark-lg">Tabwise</h1>
        <p>{m.noOperators}</p>
        <Link to="/operators/new">{m.registerFirstOperator}</Link>
        {/* M9 (ARCH §7) — terminal novo pode virar réplica de um já existente
            em vez de bootstrar operadores do zero: adota o token do terminal
            1, sincroniza e recebe os operadores dele. Escondido enquanto
            MULTI_TERMINAL_UI_ENABLED for false (feature-flags.ts) — pareamento
            é a feature que vira gancho de upgrade pago, que ainda não existe. */}
        {MULTI_TERMINAL_UI_ENABLED && (
          <p>
            <Link to="/pairing">{m.pairWithTerminal}</Link>
          </p>
        )}
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
      <LanguageToggle floating />
      <h1 className="brand-wordmark brand-wordmark-lg">Tabwise</h1>
      <p>{m.enterPin}</p>
      <div className="pin-display" aria-live="polite">
        {"•".repeat(pin.length) || " "}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="pin-pad">
        {PIN_DIGITS.map((key) => (
          <button
            key={key}
            type="button"
            className="pin-key"
            disabled={submitting}
            onClick={() => handleKey(key)}
            // Achado na validação de acessibilidade, 2026-09-23: "⌫"
            // dependia só do glifo Unicode como nome acessível, sem
            // garantia de leitura consistente entre leitores de tela —
            // no componente que é "a primeira interação de cada turno,
            // não pode falhar" (EXPERIENCE.md).
            aria-label={key === "⌫" ? m.backspace : key === "OK" ? m.confirm : undefined}
          >
            {key}
          </button>
        ))}
      </div>
    </main>
  );
}

export default Login;

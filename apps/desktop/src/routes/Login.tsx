import { useNavigate } from "react-router-dom";

/** PRD 1.2 (M3) — aqui entra o formulário real de PIN. Por ora, só navega pro shell. */
function Login() {
  const navigate = useNavigate();

  return (
    <main className="container">
      <h1>Passa a Régua</h1>
      <p>Login por PIN entra no M3. Por enquanto, siga direto pro mapa de mesas.</p>
      <button onClick={() => navigate("/mesas")}>Entrar</button>
    </main>
  );
}

export default Login;

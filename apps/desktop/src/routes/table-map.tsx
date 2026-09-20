import { Link } from "react-router-dom";

/** PRD 2.4 (M5) — mapa de mesas + comandas abertas de verdade entra aqui. */
function TableMap() {
  return (
    <section>
      <h2>Mapa de Mesas</h2>
      <p>Mesas, comandas abertas e comandas avulsas entram no M5.</p>
      <Link to="/orders/exemplo">Ver comanda de exemplo →</Link>
    </section>
  );
}

export default TableMap;

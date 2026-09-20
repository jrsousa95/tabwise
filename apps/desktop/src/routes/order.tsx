import { useParams } from "react-router-dom";

/** PRD Épico 4/5 (M6/M7) — lançamento de itens e fechamento entram aqui. */
function Order() {
  const { orderId } = useParams<{ orderId: string }>();

  return (
    <section>
      <h2>Comanda {orderId}</h2>
      <p>Lançamento de itens (M6) e fechamento (M7) entram aqui.</p>
    </section>
  );
}

export default Order;

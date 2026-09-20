import { Navigate, Route, Routes } from "react-router-dom";
import "./app.css";
import Layout from "./layout";
import Login from "./routes/login";
import TableMap from "./routes/table-map";
import Order from "./routes/order";
import CashRegister from "./routes/cash-register";

/** M2 (implementation-plan.md): shell navegável entre telas, sem lógica de negócio ainda. */
function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="/tables" element={<TableMap />} />
        <Route path="/orders/:orderId" element={<Order />} />
        <Route path="/cash-register" element={<CashRegister />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;

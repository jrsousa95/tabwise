import { Navigate, Route, Routes } from "react-router-dom";
import "./app.css";
import Layout from "./layout";
import { RequireSession, RequireRole } from "./route-guards";
import Login from "./routes/login";
import OperatorRegistration from "./routes/operator-registration";
import TableMap from "./routes/table-map";
import Order from "./routes/order";
import CashRegister from "./routes/cash-register";

/** M2/M3 (implementation-plan.md): shell navegável com autenticação e permissões por papel. */
function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/operators/new" element={<OperatorRegistration />} />
      <Route element={<RequireSession />}>
        <Route element={<Layout />}>
          <Route path="/tables" element={<TableMap />} />
          <Route path="/orders/:orderId" element={<Order />} />
          <Route element={<RequireRole allowed={["owner", "cashier"]} />}>
            <Route path="/cash-register" element={<CashRegister />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;

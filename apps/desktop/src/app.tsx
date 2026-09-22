import { Navigate, Route, Routes } from "react-router-dom";
import "./app.css";
import Layout from "./layout";
import { RequireSession, RequireRole } from "./route-guards";
import Login from "./routes/login";
import OperatorRegistration from "./routes/operator-registration";
import TableMap from "./routes/table-map";
import Order from "./routes/order";
import CashRegister from "./routes/cash-register";
import Catalog from "./routes/catalog";
import EstablishmentSettings from "./routes/establishment-settings";
import Pairing from "./routes/pairing";

/** M2/M3/M4 (implementation-plan.md): shell navegável com autenticação, permissões por papel e catálogo. */
function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/operators/new" element={<OperatorRegistration />} />
      <Route path="/pairing" element={<Pairing />} />
      <Route element={<RequireSession />}>
        <Route element={<Layout />}>
          <Route path="/tables" element={<TableMap />} />
          <Route path="/orders/:orderId" element={<Order />} />
          <Route element={<RequireRole allowed={["owner", "cashier"]} />}>
            <Route path="/cash-register" element={<CashRegister />} />
          </Route>
          <Route element={<RequireRole allowed={["owner"]} />}>
            <Route path="/catalog" element={<Catalog />} />
            <Route path="/settings" element={<EstablishmentSettings />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;

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
import TableConflicts from "./routes/table-conflicts";
import Reports from "./routes/reports";
import ConsolidatedReport from "./routes/consolidated-report";
import { MULTI_TERMINAL_UI_ENABLED } from "./lib/feature-flags";

/** M2/M3/M4 (implementation-plan.md): shell navegável com autenticação, permissões por papel e catálogo. */
function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/operators/new" element={<OperatorRegistration />} />
      {/* Pareamento/multi-terminal escondido enquanto MULTI_TERMINAL_UI_ENABLED
          for false (feature-flags.ts) — a rota some de verdade (não só o link),
          pra não dar pra chegar nela digitando a URL direto. */}
      <Route path="/pairing" element={MULTI_TERMINAL_UI_ENABLED ? <Pairing /> : <Navigate to="/" replace />} />
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
            <Route
              path="/table-conflicts"
              element={MULTI_TERMINAL_UI_ENABLED ? <TableConflicts /> : <Navigate to="/tables" replace />}
            />
            <Route path="/reports" element={<Reports />} />
            <Route
              path="/consolidated-report"
              element={MULTI_TERMINAL_UI_ENABLED ? <ConsolidatedReport /> : <Navigate to="/tables" replace />}
            />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;

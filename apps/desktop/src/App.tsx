import { Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import Layout from "./Layout";
import Login from "./routes/Login";
import MapaDeMesas from "./routes/MapaDeMesas";
import Comanda from "./routes/Comanda";
import Caixa from "./routes/Caixa";

/** M2 (implementation-plan.md): shell navegável entre telas, sem lógica de negócio ainda. */
function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="/mesas" element={<MapaDeMesas />} />
        <Route path="/comanda/:comandaId" element={<Comanda />} />
        <Route path="/caixa" element={<Caixa />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;

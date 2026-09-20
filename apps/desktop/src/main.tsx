import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./app";

// HashRouter em vez de BrowserRouter: o protocolo de asset do Tauri
// (tauri://localhost / https://tauri.localhost) não tem um servidor por
// trás pra resolver rotas de History API em reload/deep-link.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyMotion, applyTheme, getStoredMotion, getStoredTheme } from "./lib/theme";
import "./index.css";

applyTheme(getStoredTheme());
applyMotion(getStoredMotion());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

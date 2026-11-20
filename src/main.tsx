import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { QuickCabinet } from "./components/QuickCabinet";
import "./index.css";

const isCabinetMode =
  new URLSearchParams(window.location.search).get("mode") === "cabinet";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isCabinetMode ? <QuickCabinet /> : <App />}
  </React.StrictMode>
);

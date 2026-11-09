import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { installWebviewGuards } from "./lib/webview";
import { installZoom } from "./lib/zoom";

installWebviewGuards();
installZoom();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { installWebviewGuards } from "./shared/lib/webview";
import { installZoom } from "./features/shell/zoom";

installWebviewGuards();
installZoom();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

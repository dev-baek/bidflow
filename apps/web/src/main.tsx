import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { parseRuntimeConfig } from "./shared/config/runtime-config";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("root element is required");
}

createRoot(root).render(
  <StrictMode>
    <App configResult={parseRuntimeConfig(import.meta.env)} />
  </StrictMode>,
);

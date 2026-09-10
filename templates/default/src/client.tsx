import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { AiricProvider } from "@airic/ui";
import { createAiricClient } from "@airic/client";
import { App } from "./ui/App.js";
import "@airic/ui/style.css";
import "./ui/style.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AiricProvider client={createAiricClient({ baseUrl: "/api/airic" })}>
        <App />
      </AiricProvider>
    </BrowserRouter>
  </StrictMode>,
);

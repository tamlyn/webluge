import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary
      fallback={(error) => (
        <main className="connect">
          <h1>Webluge</h1>
          <p className="error">Something went wrong: {String(error)}</p>
          <div className="connect-actions">
            <button className="key primary" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        </main>
      )}
    >
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

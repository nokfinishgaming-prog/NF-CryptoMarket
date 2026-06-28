import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

/* ----------------------------------------------------------------------------
   Persistence shim.
   Inside the Claude preview, a `window.storage` API is provided by the host.
   When this app is self-hosted (Netlify, Vercel, local dev, etc.) that API does
   not exist, so we back it with the browser's localStorage. This is what lets
   the paper-trading account balance, open positions, history, and your chart
   drawings persist across page refreshes when deployed.

   App.jsx already calls window.storage behind `if (window.storage)` guards, so
   defining it here is all that's needed — no changes to App.jsx required.
---------------------------------------------------------------------------- */
if (typeof window !== "undefined" && !window.storage) {
  window.storage = {
    get: async (k) => {
      try {
        const v = localStorage.getItem(k);
        return v == null ? null : { value: v };
      } catch {
        return null;
      }
    },
    set: async (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch {}
      return null;
    },
    delete: async (k) => {
      try {
        localStorage.removeItem(k);
      } catch {}
      return null;
    },
  };
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

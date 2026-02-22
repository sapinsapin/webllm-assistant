import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/model-cache-sw.js")
      .catch((error) => console.warn("Model cache service worker registration failed", error));
  });
}

createRoot(document.getElementById("root")!).render(<App />);

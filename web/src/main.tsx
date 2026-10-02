import { createRoot } from "react-dom/client";

import App from "./App";
import { AppProviders } from "./providers";
import { GameProvider } from "./state/game";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <AppProviders>
    <GameProvider>
      <App />
    </GameProvider>
  </AppProviders>,
);

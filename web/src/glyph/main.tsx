import { createRoot } from "react-dom/client";

import { AppProviders } from "../providers";
import "../styles.css";
import GlyphApp from "./GlyphApp";
import { GlyphProvider } from "./state";

createRoot(document.getElementById("root")!).render(
  <AppProviders>
    <GlyphProvider>
      <GlyphApp />
    </GlyphProvider>
  </AppProviders>,
);

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // next-auth imports "next/server" without an extension, which Node's ESM
    // resolver rejects; inlining lets Vite resolve it (src/auth.test.ts).
    server: { deps: { inline: ["next-auth"] } },
  },
});

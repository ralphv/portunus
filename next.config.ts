import type { NextConfig } from "next";
const isNotProduction = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
   logging: {
    browserToTerminal: isNotProduction ? true : false,
    incomingRequests: {
      ignore: [/\/api\/v1\/health/],
    },
  },
  output: "standalone",
  // scripts/script-integrity.mjs pins one id across its two builds so the
  // prerendered inline scripts (which embed it) hash the same; unset → random.
  generateBuildId: async () => process.env.PORTUNUS_BUILD_ID || null,
  cacheComponents: true,
  partialPrefetching: true,
  // Code lives on a Windows-mounted drive (/mnt/d) under WSL — native file
  // events don't cross the boundary, so dev mode needs polling.
  watchOptions: { pollIntervalMs: 1000 },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

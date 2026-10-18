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

// Smoke-test harness that brings its own server: builds the production
// image, deploys it to a throwaway demo-mode container, runs the shared
// tests (scripts/smoke/tests.mjs) against it, and always removes the
// container afterwards:
//
//   npm run full-smoke
//   HEADED=1 npm run full-smoke     # watch the browser (WSLg / any display)
//   KEEP_OPEN=1 npm run full-smoke  # watch, then explore until Enter; container removed after
//
// Uses its own container name and port (SMOKE_PORT, default 3002) so a
// `portunus-local` started with `npm run deploy:local` is left alone. All
// options: SMOKE.md.

import { spawnSync } from "node:child_process";
import { runSmokeTests } from "./run-tests.mjs";

const PORT = process.env.SMOKE_PORT ?? "3002";
const deploy = (...args) =>
  spawnSync(
    process.execPath,
    [new URL("../deploy-local.mjs", import.meta.url).pathname, ...args],
    { stdio: "inherit", env: { ...process.env, PORT, CONTAINER: "portunus-smoke" } },
  ).status ?? 1;

let ok = false;
try {
  ok = deploy() === 0 && (await runSmokeTests(`http://localhost:${PORT}`));
} finally {
  // The container (and its log) is about to go — print the server's side of
  // a failure first.
  if (!ok) {
    console.error("\n--- portunus-smoke server log (last 200 lines) ---");
    spawnSync(process.env.DOCKER ?? "docker", ["logs", "--tail", "200", "portunus-smoke"], {
      stdio: "inherit",
    });
  }
  deploy("stop");
}
process.exit(ok ? 0 : 1);

// Smoke-test harness for an already running demo-mode server:
//
//   npm run deploy:local && npm run smoke                     # Docker on :3001
//   BASE_URL=http://localhost:3000 npm run smoke              # PORTUNUS_DEMO_MODE=1 npm run dev
//   HEADED=1 npm run smoke                                    # watch it run
//   KEEP_OPEN=1 npm run smoke                                 # watch, then explore until Enter
//
// The tests live in scripts/smoke/tests.mjs; `npm run full-smoke` runs the
// same tests against a freshly built throwaway container. All options
// (HEADED, SLOWMO, KEEP_OPEN, BASE_URL): SMOKE.md.

import { runSmokeTests } from "./run-tests.mjs";

const ok = await runSmokeTests(process.env.BASE_URL ?? "http://localhost:3001");
process.exit(ok ? 0 : 1);

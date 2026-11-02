// The smoke tests, shared by every harness (scripts/smoke/smoke.mjs,
// scripts/smoke/full-smoke.mjs). They run in order against one page and build on
// each other — a failure stops the rest. `ctx` carries:
//   page     Playwright page (fresh context → fresh demo vault)
//   baseUrl  server under test
//   workDir  temp dir for downloads (deleted after a passing run)
//   state    scratch object tests use to hand data to later tests
//   offlineCache  false when the server runs with DISABLE_OFFLINE_MODE
//
// One module per README feature group under ./tests/; shared UI moves are in
// ./helpers.mjs, network stubs in ./network.mjs. Add a test by appending
// { name, run } to the module it belongs to — the runner reports each name as
// it goes and fails on any page error, console error or unexpected HTTP
// error. A test that expects an HTTP error lists it in `allowHttp` as
// { status, method, path }; one that expects a console error lists a RegExp
// in `allowConsole`. Both are tolerated during that test only.
//
// Keep the "Test cases" table in SMOKE.md in sync.

import { coreTests } from "./tests/core.mjs";
import { entryTests } from "./tests/entries.mjs";
import { entryTotpTests } from "./tests/entry-totp.mjs";
import { hibpTests } from "./tests/hibp.mjs";
import { historyTests } from "./tests/history.mjs";
import { keyfileTests } from "./tests/keyfile.mjs";
import { offlineTests } from "./tests/offline.mjs";
import { pageSecurityTests } from "./tests/page-security.mjs";
import { secretTests } from "./tests/secrets.mjs";
import { securityDialogTests } from "./tests/security-dialog.mjs";
import { sessionTests } from "./tests/session.mjs";
import { settingsTests } from "./tests/settings.mjs";
import { twoFactorTests } from "./tests/two-factor.mjs";

export const tests = [
  ...coreTests,
  ...keyfileTests,
  ...entryTests,
  ...secretTests,
  ...historyTests,
  ...hibpTests,
  ...entryTotpTests,
  ...settingsTests,
  ...offlineTests,
  ...securityDialogTests,
  ...twoFactorTests,
  ...pageSecurityTests,
  // Fakes the page clock — keep last.
  ...sessionTests,
];

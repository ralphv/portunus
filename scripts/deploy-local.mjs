// Builds the production Docker image and runs it locally in demo mode, so a
// change can be checked against the real standalone build (strict CSP hashes,
// `next start` behaviour) rather than `next dev`:
//
//   npm run deploy:local          # build + (re)start portunus-local on :3001
//   npm run deploy:local:stop     # remove the container
//
// DOCKER=docker.exe overrides the binary (WSL without Docker Desktop
// integration), PORT changes the host port, CONTAINER the container name.
// Then run `npm run smoke`.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DOCKER = process.env.DOCKER ?? "docker";
const PORT = process.env.PORT ?? "3001";
const IMAGE = "portunus:local";
const CONTAINER = process.env.CONTAINER ?? "portunus-local";
const BASE_URL = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 90_000;

const docker = (args, opts = {}) =>
  execFileSync(DOCKER, args, { stdio: "inherit", ...opts });
const removeContainer = () =>
  docker(["rm", "-f", CONTAINER], { stdio: ["ignore", "ignore", "ignore"] });

if (process.argv[2] === "stop") {
  try {
    removeContainer();
  } catch {
    // Not running — nothing to do.
  }
  console.log(`Removed ${CONTAINER}`);
  process.exit(0);
}

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

docker(["build", "--build-arg", `APP_VERSION=${version}`, "-t", IMAGE, "."]);
try {
  removeContainer();
} catch {
  // First deploy — no previous container.
}
docker([
  "run", "-d",
  "--name", CONTAINER,
  "-p", `${PORT}:3000`,
  "-e", "PORTUNUS_DEMO_MODE=1",
  IMAGE,
]);

// Demo mode answers an unauthenticated /api/vault with vault_not_found
// (Google mode would 401) — that doubles as the readiness probe.
const deadline = Date.now() + READY_TIMEOUT_MS;
for (;;) {
  try {
    const res = await fetch(`${BASE_URL}/api/vault`);
    const body = await res.json();
    if (body.error === "vault_not_found") break;
  } catch {
    // Server still starting.
  }
  if (Date.now() > deadline) {
    console.error(`${CONTAINER} did not become ready at ${BASE_URL}`);
    docker(["logs", "--tail", "50", CONTAINER]);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.log(`${CONTAINER} (demo mode) ready at ${BASE_URL}`);

// Builds the production Docker image and runs it locally in demo mode, so a
// change can be checked against the real standalone build (strict CSP hashes,
// `next start` behaviour) rather than `next dev`:
//
//   npm run deploy:local          # build + (re)start portunus-local on :3001
//   npm run deploy:local:stop     # remove the container
//
// DOCKER=docker.exe overrides the binary (WSL without Docker Desktop
// integration), PORT changes the host port, CONTAINER the container name,
// DISABLE_OFFLINE_MODE, PORTUNUS_BIOMETRIC_UNLOCK,
// PORTUNUS_BIOMETRIC_SAVE_CONFIRM, PORTUNUS_AUTO_LOCK_SECONDS and
// PORTUNUS_HIDDEN_LOCK_SECONDS are passed through to the container.
// Then run `npm run smoke`.
//
// Demo mode itself is switched on through PORTUNUS_DEMO_MODE_FILE (a secret
// file copied into the container), not PORTUNUS_DEMO_MODE, so every deploy and
// smoke run goes through the image's `*_FILE` entrypoint: if it breaks, demo
// mode is off, the server refuses to start without AUTH_* vars, and the
// readiness check below fails.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DOCKER = process.env.DOCKER ?? "docker";
const PORT = process.env.PORT ?? "3001";
const IMAGE = "portunus:local";
const CONTAINER = process.env.CONTAINER ?? "portunus-local";
const BASE_URL = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 90_000;
// Where the demo-mode secret lands in the container. Written with a CRLF
// ending on purpose: the entrypoint must strip it.
const DEMO_MODE_SECRET = { dir: "/tmp", name: "portunus-demo-mode", contents: "1\r\n" };

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
// A one-file ustar archive, for `docker cp - <container>:<dir>` (works with
// any Docker binary, unlike a bind mount of a host path from WSL).
function tarOneFile(name, contents) {
  const data = Buffer.from(contents);
  const header = Buffer.alloc(512);
  const put = (value, offset) => header.write(value, offset, "ascii");
  put(name, 0);
  put("0000644\0", 100); // mode: readable by the image's non-root user
  put("0000000\0", 108); // uid
  put("0000000\0", 116); // gid
  put(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
  put(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, "0")}\0`, 136);
  put("        ", 148); // checksum placeholder: spaces while summing
  put("0", 156); // regular file
  put("ustar\0" + "00", 257);
  const sum = header.reduce((a, b) => a + b, 0);
  put(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, pad, Buffer.alloc(1024)]);
}

docker([
  "create",
  "--name", CONTAINER,
  "-p", `${PORT}:3000`,
  "-e", `PORTUNUS_DEMO_MODE_FILE=${DEMO_MODE_SECRET.dir}/${DEMO_MODE_SECRET.name}`,
  ...["DISABLE_OFFLINE_MODE", "PORTUNUS_BIOMETRIC_UNLOCK", "PORTUNUS_BIOMETRIC_SAVE_CONFIRM", "PORTUNUS_AUTO_LOCK_SECONDS", "PORTUNUS_HIDDEN_LOCK_SECONDS"]
    .filter((name) => process.env[name])
    .flatMap((name) => ["-e", `${name}=${process.env[name]}`]),
  IMAGE,
], { stdio: ["ignore", "ignore", "inherit"] });
docker(["cp", "-", `${CONTAINER}:${DEMO_MODE_SECRET.dir}`], {
  input: tarOneFile(DEMO_MODE_SECRET.name, DEMO_MODE_SECRET.contents),
  stdio: ["pipe", "inherit", "inherit"],
});
docker(["start", CONTAINER], { stdio: ["ignore", "ignore", "inherit"] });

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

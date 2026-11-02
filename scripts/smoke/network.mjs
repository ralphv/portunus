// Network fixtures for the smoke tests: a guard that keeps the browser on
// the server under test, a stand-in for the Have I Been Pwned range API (so
// runs are hermetic and breaches are deterministic) and a log of every
// request the browser makes (for the zero-knowledge check).

import { createHash } from "node:crypto";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Aborts every request that doesn't go to the server under test and reports
// it through `onBlocked`, so a new outside call fails the run instead of
// quietly depending on the internet. Install it before any other route:
// routes added later (the Pwned Passwords stub, a test's own page.route)
// take precedence, and the guard only sees what they pass on. The server
// counts as reached on any loopback name for its port, since Auth.js
// redirects to "localhost" whatever BASE_URL says.
export async function blockExternalRequests(context, baseUrl, onBlocked) {
  const server = new URL(baseUrl);
  const isServer = (url) =>
    url.origin === server.origin ||
    (LOOPBACK.has(url.hostname) && LOOPBACK.has(server.hostname) && url.port === server.port);
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (isServer(url)) return route.fallback();
    onBlocked(`external request blocked: ${route.request().method()} ${url.href}`);
    return route.abort("blockedbyclient");
  });
}

export const HIBP_RANGE = "https://api.pwnedpasswords.com/range/";
export const BREACHED_PASSWORD = "password";
export const BREACH_COUNT = 1234;

const sha1 = (text) => createHash("sha1").update(text).digest("hex").toUpperCase();

// Answers every range request like the real API with Add-Padding: the
// suffixes of BREACHED_PASSWORD's prefix bucket plus a zero-count decoy.
export async function installHibpStub(context, state) {
  state.hibpRequests ??= [];
  const hash = sha1(BREACHED_PASSWORD);
  await context.route(`${HIBP_RANGE}*`, (route) => {
    const req = route.request();
    state.hibpRequests.push({ url: req.url(), headers: req.headers() });
    const prefix = req.url().slice(HIBP_RANGE.length);
    const lines = ["0000000000000000000000000000000000A:0"];
    if (prefix === hash.slice(0, 5)) lines.push(`${hash.slice(5)}:${BREACH_COUNT}`);
    return route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*", "content-type": "text/plain" },
      body: lines.join("\r\n"),
    });
  });
}

// Every request from every page and worker of the context.
export function recordRequests(context, state) {
  state.requests = [];
  context.on("request", (r) =>
    state.requests.push({ method: r.method(), url: r.url(), body: r.postData() ?? "" }),
  );
}

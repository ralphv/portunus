import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./docker-entrypoint.sh", import.meta.url));
// The command the entrypoint execs: dumps the environment it was handed.
const DUMP_ENV = [process.execPath, "-e", "process.stdout.write(JSON.stringify(process.env))"];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "portunus-entrypoint-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function secret(name: string, contents: string): string {
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

function run(env: Record<string, string>) {
  // A minimal env, so variables from the test runner don't leak in.
  const res = spawnSync("sh", [SCRIPT, ...DUMP_ENV], {
    env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
  });
  return {
    status: res.status,
    stderr: res.stderr,
    env: res.status === 0 ? (JSON.parse(res.stdout) as Record<string, string>) : {},
  };
}

describe("docker-entrypoint.sh", () => {
  it("execs the command unchanged when no *_FILE variable is set", () => {
    const { status, env } = run({ AUTH_URL: "http://localhost:3000" });
    expect(status).toBe(0);
    expect(env.AUTH_URL).toBe("http://localhost:3000");
  });

  it("reads NAME from NAME_FILE and removes NAME_FILE", () => {
    const { status, env } = run({ AUTH_SECRET_FILE: secret("s", "top-secret") });
    expect(status).toBe(0);
    expect(env.AUTH_SECRET).toBe("top-secret");
    expect(env).not.toHaveProperty("AUTH_SECRET_FILE");
  });

  it("handles any variable ending in _FILE, several at once", () => {
    const { status, env } = run({
      PORTUNUS_DEMO_MODE_FILE: secret("a", "1"),
      SOME_FUTURE_SETTING_FILE: secret("b", "x"),
      PLAIN: "kept",
    });
    expect(status).toBe(0);
    expect(env).toMatchObject({ PORTUNUS_DEMO_MODE: "1", SOME_FUTURE_SETTING: "x", PLAIN: "kept" });
  });

  it("strips trailing newlines and CRLF but keeps inner whitespace and lines", () => {
    const { env } = run({
      A_FILE: secret("a", "value\n\n"),
      B_FILE: secret("b", "value\r\n"),
      C_FILE: secret("c", "line 1\nline  2\n"),
    });
    expect(env.A).toBe("value");
    expect(env.B).toBe("value");
    expect(env.C).toBe("line 1\nline  2");
  });

  it("keeps shell metacharacters literally", () => {
    const tricky = "a$b`c`\"d' $(echo x) *;|&";
    const { status, env } = run({ X_FILE: secret("x", tricky) });
    expect(status).toBe(0);
    expect(env.X).toBe(tricky);
  });

  it("refuses to start when both NAME and NAME_FILE are set", () => {
    const { status, stderr } = run({ AUTH_SECRET: "a", AUTH_SECRET_FILE: secret("s", "b") });
    expect(status).not.toBe(0);
    expect(stderr).toContain("AUTH_SECRET");
  });

  it("refuses to start when the file is missing, without leaking contents", () => {
    const { status, stderr } = run({ AUTH_SECRET_FILE: join(dir, "nope") });
    expect(status).not.toBe(0);
    expect(stderr).toContain("AUTH_SECRET_FILE");
  });

  it("refuses to start when the file is empty or only newlines", () => {
    expect(run({ AUTH_SECRET_FILE: secret("e", "") }).status).not.toBe(0);
    expect(run({ AUTH_SECRET_FILE: secret("n", "\n\r\n") }).status).not.toBe(0);
  });

  it("refuses to start when NAME_FILE is empty or a directory", () => {
    expect(run({ AUTH_SECRET_FILE: "" }).status).not.toBe(0);
    expect(run({ AUTH_SECRET_FILE: dir }).status).not.toBe(0);
  });

  it.skipIf(process.getuid?.() === 0)("refuses to start when the file is unreadable", () => {
    const path = secret("u", "secret-value");
    chmodSync(path, 0o000);
    const { status, stderr } = run({ AUTH_SECRET_FILE: path });
    expect(status).not.toBe(0);
    expect(stderr).not.toContain("secret-value");
  });
});

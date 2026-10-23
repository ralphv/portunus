import { vi } from "vitest";

import { generateKeyfile } from "@/crypto";
import type { VaultSecrets } from "@/crypto";

// In-memory /api/vault + localStorage + Pwned Passwords stubs for tests that
// run the vault core in node.

export type VaultApiStub = {
  store: { fileId: string; modifiedTime: string; contents: string } | null;
  putBodies: Record<string, unknown>[];
  pwned: Map<string, number>; // SHA-1 hex (upper) → count
  // Lets a test run code while an upload is in flight.
  beforePut: (() => void | Promise<void>) | null;
};

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

export function installVaultApiStub(): VaultApiStub {
  const stub: VaultApiStub = {
    store: null,
    putBodies: [],
    pwned: new Map(),
    beforePut: null,
  };
  let mt = 0;
  const mem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://api.pwnedpasswords.com/range/")) {
        const prefix = url.slice(-5);
        const lines = [...stub.pwned]
          .filter(([h]) => h.startsWith(prefix))
          .map(([h, n]) => `${h.slice(5)}:${n}`);
        return new Response(lines.join("\r\n"));
      }
      if (init?.method === "PUT") {
        await stub.beforePut?.();
        const body = JSON.parse(init.body as string);
        stub.putBodies.push(body);
        if (
          body.baseModifiedTime &&
          stub.store &&
          body.baseModifiedTime !== stub.store.modifiedTime
        ) {
          return json(409, { error: "conflict" });
        }
        stub.store = {
          fileId: (body.fileId as string) ?? "file-1",
          modifiedTime: `t${++mt}`,
          contents: body.contents as string,
        };
        return json(200, {
          fileId: stub.store.fileId,
          modifiedTime: stub.store.modifiedTime,
        });
      }
      if (!stub.store) return json(404, { error: "vault_not_found" });
      return json(200, stub.store);
    }),
  );
  return stub;
}

export async function makeSecrets(password = "pw"): Promise<VaultSecrets> {
  const { keyfile } = await generateKeyfile();
  return { password, keyfile: keyfile.key };
}

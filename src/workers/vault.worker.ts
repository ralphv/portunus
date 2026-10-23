// The vault Worker: holds the keys, the decrypted vault and its secrets for
// one unlocked session. Locking terminates it, which drops all of that memory.
import { createVaultHandler } from "@/lib/vault-rpc";
import type { VaultRequest } from "@/lib/vault-rpc";
import { VaultWorkerCore } from "@/lib/vault-worker-core";

const scope = self as unknown as {
  postMessage(message: unknown): void;
  addEventListener(
    type: "message",
    listener: (e: MessageEvent<VaultRequest>) => void,
  ): void;
};

const handle = createVaultHandler(new VaultWorkerCore());

scope.addEventListener("message", (e) => {
  void handle(e.data).then((res) => scope.postMessage(res));
});

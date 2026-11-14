import type { VaultWorkerLike } from "./vault-client";
import { createVaultHandler } from "./vault-rpc";
import type { VaultRequest, VaultResponse } from "./vault-rpc";
import { VaultWorkerCore } from "./vault-worker-core";

// Runs the real Worker message handler in-process, with structured cloning
// in both directions like postMessage.
export function inProcessWorker(): VaultWorkerLike & { terminated: boolean } {
  const handle = createVaultHandler(new VaultWorkerCore());
  const w = {
    terminated: false,
    onmessage: null as ((e: MessageEvent<VaultResponse>) => void) | null,
    onerror: null,
    postMessage(req: VaultRequest) {
      void handle(structuredClone(req)).then((res) => {
        if (!w.terminated) {
          w.onmessage?.({ data: structuredClone(res) } as MessageEvent<VaultResponse>);
        }
      });
    },
    terminate() {
      w.terminated = true;
    },
  };
  return w;
}

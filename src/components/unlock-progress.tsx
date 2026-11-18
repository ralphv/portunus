import {
  UNLOCK_PROGRESS_TITLE,
  UNLOCK_STAGE_DERIVE,
  UNLOCK_STAGE_FETCH,
} from "@/constants";
import { PortunusEmblem } from "./portunus-emblem";

// The real steps of an unlock: download the encrypted vault (the first
// attempt after a page load; retries reuse it), then derive the key with
// Argon2id and decrypt — slow on purpose.
export type UnlockStage = "fetch" | "derive";

const STAGE_TEXT: Record<UnlockStage, string> = {
  fetch: UNLOCK_STAGE_FETCH,
  derive: UNLOCK_STAGE_DERIVE,
};

// Laid over the unlock card while an unlock runs: the keyhole emblem in a
// spinning progress ring, and the current step. Over the form, not instead
// of it, so the card keeps its size and the form (password, error) is
// still there when an attempt fails.
export function UnlockProgress({ stage }: { stage: UnlockStage }) {
  return (
    <div
      data-unlock-progress=""
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 rounded-[28px] bg-surface-container-low px-6"
    >
      <div className="relative h-24 w-24">
        <PortunusEmblem className="h-24 w-24" />
        <div
          aria-hidden="true"
          className="absolute -inset-2.5 animate-spin rounded-full border-[3px] border-primary/20 border-t-primary [animation-duration:1.1s] motion-reduce:animate-none"
        />
      </div>
      <p className="text-xl text-on-surface">{UNLOCK_PROGRESS_TITLE}</p>
      <p role="status" className="h-5 text-sm text-on-surface-variant">
        {/* Keyed, so each new step fades in. */}
        <span key={stage} className="portunus-step-in inline-block">
          {STAGE_TEXT[stage]}
        </span>
      </p>
    </div>
  );
}

"use client";

import { STRENGTH_LABELS } from "@/constants";
import type { PasswordStrength } from "@/lib/password-strength";

// Fill colour per zxcvbn score (0–4): red → amber → emerald.
const STRENGTH_COLORS = [
  "bg-error",
  "bg-error/70",
  "bg-warning",
  "bg-success/70",
  "bg-success",
];

// Thin 5-segment meter with a label, estimated crack time and the first
// zxcvbn hint. Shared by the entry-password editor and the master-password
// create / change screens so they score and read identically.
export function PasswordStrengthMeter({
  strength,
  checking,
}: {
  strength: PasswordStrength | null;
  checking: boolean;
}) {
  const filled = strength ? strength.score + 1 : 0;
  const color = strength ? STRENGTH_COLORS[strength.score] : "bg-outline";
  return (
    <div className="mt-2" aria-live="polite">
      <div
        className="flex gap-1"
        role="meter"
        aria-label="Password strength"
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuenow={filled}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              i < filled ? color : "bg-outline-variant"
            }`}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-on-surface-variant">
        {strength ? (
          <>
            <span
              className={
                strength.score <= 1
                  ? "text-error"
                  : strength.score === 2
                    ? "text-warning"
                    : "text-success"
              }
            >
              {STRENGTH_LABELS[strength.score]}
            </span>
            <span className="text-on-surface-variant">
              {" "}
              · {strength.crackTime} to crack
            </span>
            {strength.hint && (
              <span className="block text-on-surface-variant">
                {strength.hint}
              </span>
            )}
          </>
        ) : (
          <span className="text-on-surface-variant">
            {checking ? "scoring…" : ""}
          </span>
        )}
      </p>
    </div>
  );
}

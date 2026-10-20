// Password strength via zxcvbn (Dropbox's estimator). The library plus its
// dictionaries are a few hundred KB, so they're loaded on first use and
// cached — typing a password doesn't cost bundle weight for everyone.

import type { ZxcvbnFactory } from "@zxcvbn-ts/core";

export type PasswordStrength = {
  // 0 (worst) – 4 (best); matches zxcvbn's score.
  score: 0 | 1 | 2 | 3 | 4;
  // Human-readable crack time for the middle scenario, e.g. "centuries",
  // "3 hours".
  crackTime: string;
  // First warning/suggestion zxcvbn produced, if any.
  hint: string | null;
};

let ready: Promise<ZxcvbnFactory> | null = null;

function loadZxcvbn(): Promise<ZxcvbnFactory> {
  ready ??= Promise.all([
    import("@zxcvbn-ts/core"),
    import("@zxcvbn-ts/language-common"),
    import("@zxcvbn-ts/language-en"),
  ]).then(
    ([core, common, en]) =>
      new core.ZxcvbnFactory({
        dictionary: { ...common.dictionary, ...en.dictionary },
        graphs: common.adjacencyGraphs,
        translations: en.translations,
      }),
  );
  return ready;
}

export async function checkPasswordStrength(
  password: string,
  userInputs: string[] = [],
): Promise<PasswordStrength> {
  const zxcvbn = await loadZxcvbn();
  const result = zxcvbn.check(
    password,
    userInputs.filter(Boolean),
  );
  const feedback = result.feedback;
  const hint = feedback.warning || feedback.suggestions[0] || null;
  return {
    score: result.score,
    crackTime: result.crackTimes.offlineSlowHashingXPerSecond.display,
    hint,
  };
}

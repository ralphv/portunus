"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { DeviceUnlockRecord } from "@/crypto/device-unlock-record";
import type { BiometricInterface } from "@/lib/biometric/biometric-interface";
import { readDeviceUnlock } from "@/lib/biometric/device-unlock-store";

export type BiometricSupport = {
  // Biometric unlock can run here (flag on, WebAuthn + PRF).
  supported: boolean;
  // The device has a built-in fingerprint/face/screen-lock authenticator:
  // gates the unprompted "set up?" offer.
  platform: boolean;
};

export function useBiometricSupport(biometric: BiometricInterface): BiometricSupport {
  const [support, setSupport] = useState<BiometricSupport>({
    supported: false,
    platform: false,
  });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supported = await biometric.isSupported();
      const platform = supported && (await biometric.hasPlatformAuthenticator());
      if (!cancelled) setSupport({ supported, platform });
    })();
    return () => {
      cancelled = true;
    };
  }, [biometric]);
  return support;
}

// This device's record for `kid` (null: not enrolled); `refresh` re-reads
// it after an enroll/remove.
export function useDeviceRecord(
  kid: string | null,
): [DeviceUnlockRecord | null, () => void] {
  const [version, setVersion] = useState(0);
  const record = useMemo(
    () => (kid ? readDeviceUnlock(kid) : null),
    // `version` forces a re-read of localStorage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kid, version],
  );
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return [record, refresh];
}

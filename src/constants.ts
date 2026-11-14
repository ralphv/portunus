// App-level constants — names, endpoints, limits.
//
// NOTE: VAULT_FOLDER_NAME, VAULT_FILENAME and the KEYFILE_* values are format
// constants, not user preferences — renaming them orphans existing Drive
// vaults / installed keyfiles. Treat as immutable once deployed.

// --- Google Drive ---
export const VAULT_FOLDER_NAME = "Portunus Application";
export const VAULT_FILENAME = "portunus.vault.json";
export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

// --- OAuth ---
export const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

// --- Vault ---
export const MAX_VAULT_BYTES = 10 * 1024 * 1024;
// localStorage slot for the last-synced ciphertext envelope (offline mode).
export const VAULT_CACHE_KEY = "portunus.vault.cache";
// localStorage mirror of the vault's "password fill & save" setting, so
// the unlock screen (rendered before the vault is loaded) applies the
// device's last-known preference. Key prefix — entries are per-vault,
// suffixed with the keyfile id (`portunus.password-fill-save.<kid>`).
export const PASSWORD_FILL_SAVE_KEY = "portunus.password-fill-save";

// localStorage slot for the entry list's sort order — a per-device UI
// preference, deliberately kept out of the vault document.
export const ENTRY_SORT_KEY = "portunus.entry-sort";

// localStorage flag ("open") for the unlock form's on-screen keyboard: the
// panel reopens on this device if it was open last time.
export const ONSCREEN_KEYBOARD_KEY = "portunus.onscreen-keyboard";

// --- Keyfile ---
export const KEYFILE_FILENAME = "portunus.key";
export const KEYFILE_STORAGE_KEY = "portunus.keyfile";

// --- UI ---
export const AUTO_LOCK_IDLE_S = 5 * 60;

// --- Schema validation (src/lib/schema-validator) ---
// Issue code for input that isn't JSON at all (Zod's own codes cover the rest).
export const SCHEMA_ISSUE_INVALID_JSON = "invalid_json";
// Issue code for a rule checked in code via .refine() (e.g. a valid TOTP secret).
export const SCHEMA_ISSUE_RULE = "rule";
// Path of an issue about the payload as a whole.
export const SCHEMA_ROOT_PATH = "(root)";

// Longest accepted two-factor code in POST /api/vault/unlock (pasted codes
// may carry spaces; real ones are 6–8 digits).
export const TOTP_CODE_MAX_LENGTH = 32;

// --- API error codes (the `error` field of /api/vault responses) ---
export const API_ERROR_BAD_REQUEST = "bad_request";

// --- Upstream responses that fail their schema ---
// StoreError status for a Drive response of the wrong shape (a bad gateway).
export const DRIVE_BAD_RESPONSE_STATUS = 502;
export const DRIVE_BAD_RESPONSE_MESSAGE = "Unexpected Google Drive response";
export const LOG_DRIVE_BAD_RESPONSE = "[vault] Google Drive response failed its schema:";
export const LOG_TOKEN_BAD_RESPONSE = "[auth] Google token response failed its schema:";

// Unlock failure on a two-factor vault: deliberately doesn't say whether the
// password, keyfile or code was wrong, so the form can't be used to test codes.
// React keys of the 2FA dialog's disable / set-up password fields: distinct, so
// a reveal on one doesn't carry over to the other.
export const TWO_FACTOR_DISABLE_PASSWORD_KEY = "disable-2fa-password";
export const TWO_FACTOR_SETUP_PASSWORD_KEY = "setup-2fa-password";
export const UNLOCK_FAILED_TWO_FACTOR_MESSAGE =
  "Wrong password, keyfile or two-factor code. Wait for a new code and try again.";
export const SHOW_PASSWORD_LABEL = "Show password";
export const HIDE_PASSWORD_LABEL = "Hide password";
export const SHOW_KEYBOARD_LABEL = "Show on-screen keyboard";
export const HIDE_KEYBOARD_LABEL = "Hide on-screen keyboard";

// On-screen keyboard (src/components/onscreen-keyboard.tsx): its key sets,
// the stored "open" flag, labels and key captions.
export const ONSCREEN_KEYBOARD_LETTERS = "abcdefghijklmnopqrstuvwxyz0123456789";
export const ONSCREEN_KEYBOARD_SYMBOLS = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
export const ONSCREEN_KEYBOARD_OPEN = "open";
export const ONSCREEN_KEYBOARD_LABEL = "On-screen keyboard";
export const ONSCREEN_KEYBOARD_SHUFFLED_NOTE = " · layout shuffled";
export const ONSCREEN_KEYBOARD_SHUFFLE_LABEL = "Shuffle keys";
export const ONSCREEN_KEYBOARD_SHIFT_LABEL = "Shift";
export const ONSCREEN_KEYBOARD_SYMBOLS_LABEL = "Symbols";
export const ONSCREEN_KEYBOARD_LETTERS_LABEL = "Letters and digits";
export const ONSCREEN_KEYBOARD_SPACE_LABEL = "Space";
export const ONSCREEN_KEYBOARD_BACKSPACE_LABEL = "Backspace";
export const ONSCREEN_KEYBOARD_DONE_LABEL = "Done";

// Entry search box; SEARCH_FOCUS_KEY focuses it while no entry is open.
export const SEARCH_FOCUS_KEY = ".";
export const SEARCH_LABEL = "Search entries";
export const SEARCH_PLACEHOLDER = "Search entries…";
export const SEARCH_HINT_PLACEHOLDER = `Search entries (press ${SEARCH_FOCUS_KEY} to focus)…`;
export const TYPING_TARGET_SELECTOR = "input, textarea, select";
export const DIALOG_SELECTOR = '[role="dialog"]';
export const ONSCREEN_KEYBOARD_CAPTIONS = {
  shuffle: "↻ Shuffle",
  shift: "⇧",
  symbols: "#+=",
  letters: "abc",
  space: "space",
  backspace: "⌫",
} as const;
// KeyboardEvent/MouseEvent.getModifierState() names.
export const MODIFIER_SHIFT = "Shift";
export const MODIFIER_CAPS_LOCK = "CapsLock";

// Name autocomplete: typed characters needed before a service is suggested.
export const SERVICE_COMPLETION_MIN_CHARS = 2;
// On touch screens the name gets a native <datalist> of service names instead.
export const SERVICE_NAMES_LIST_ID = "service-names";
export const COARSE_POINTER_QUERY = "(pointer: coarse)";

// --- Biometric (device) unlock (src/crypto/device-unlock.ts) ---
// Format constants of the per-device blob that holds a copy of the vault's
// data key, encrypted under a key derived from the passkey's PRF secret.
// Changing them orphans existing enrollments.
export const DEVICE_UNLOCK_FORMAT = "portunus-device-unlock";
export const DEVICE_UNLOCK_VERSION = 1;
// HKDF-SHA256 `info` for the wrap key derived from the PRF output.
export const DEVICE_UNLOCK_HKDF_INFO = "portunus-device-unlock-v1";
// Byte lengths: PRF output (WebAuthn hmac-secret), PRF salt, wrap key.
export const DEVICE_UNLOCK_PRF_BYTES = 32;
export const DEVICE_UNLOCK_SALT_BYTES = 32;
export const DEVICE_UNLOCK_KEY_BYTES = 32;
// Envelope fields left out of the header digest: per-save ciphertext and the
// discoverability URL added at serialization.
export const DEVICE_UNLOCK_DIGEST_EXCLUDED_FIELDS = [
  "nonce",
  "ciphertext",
  "website",
] as const;
export const ENGINE_UPGRADE_PASSWORD_REQUIRED_MESSAGE =
  "Master password required to upgrade the vault's encryption";
export const DEVICE_UNLOCK_INVALID_MESSAGE = "Not a valid biometric unlock record";
// Generic on purpose: never says whether the passkey secret, the record or
// the keyfile was wrong.
export const DEVICE_UNLOCK_FAILED_MESSAGE = "Biometric unlock failed";
export const DEVICE_UNLOCK_STALE_MESSAGE =
  "Biometric unlock needs to be set up again — the vault's master password or encryption changed";

// --- Biometric unlock: WebAuthn + per-device storage (src/lib/biometric/) ---
// Env flag (server side) that turns the feature on; anything else = off.
export const BIOMETRIC_UNLOCK_ENV = "PORTUNUS_BIOMETRIC_UNLOCK";
export const BIOMETRIC_UNLOCK_ENV_ON = "1";
// localStorage: the device record, per keyfile id
// (`portunus.device-unlock.<kid>`), and the "Not now" answer to the
// post-unlock offer (`portunus.device-unlock-dismissed.<kid>` = "1").
export const DEVICE_UNLOCK_STORAGE_PREFIX = "portunus.device-unlock.";
export const DEVICE_UNLOCK_DISMISSED_PREFIX = "portunus.device-unlock-dismissed.";
export const DEVICE_UNLOCK_DISMISSED_VALUE = "1";
// WebAuthn ceremony parameters.
export const WEBAUTHN_RP_NAME = "Portunus";
export const WEBAUTHN_USER_NAME_PREFIX = "Portunus vault ";
export const WEBAUTHN_USER_DISPLAY_NAME = "Portunus vault";
export const WEBAUTHN_TIMEOUT_MS = 60_000;
export const WEBAUTHN_CHALLENGE_BYTES = 32;
export const WEBAUTHN_USER_ID_BYTES = 16;
// COSE algorithms offered at registration: ES256, EdDSA, RS256.
export const WEBAUTHN_ALGORITHMS = [-7, -8, -257] as const;
export const WEBAUTHN_PUBLIC_KEY = "public-key";
export const WEBAUTHN_PRF_CAPABILITY = "extension:prf";
// DOMException names the browser uses for a cancelled / refused check.
export const WEBAUTHN_NOT_ALLOWED = "NotAllowedError";
export const WEBAUTHN_ABORT = "AbortError";
export const BIOMETRIC_UNSUPPORTED_MESSAGE =
  "This device or browser can't do biometric unlock";
export const BIOMETRIC_CANCELLED_MESSAGE = "Biometric check was cancelled";
export const BIOMETRIC_FAILED_MESSAGE = "Biometric check failed";

// Biometric unlock UI ("biometrics" covers fingerprint, face and screen lock).
// Env flag (server side): "0" makes saves always ask for the master
// password; anything else lets biometrics confirm a save.
export const BIOMETRIC_SAVE_CONFIRM_ENV = "PORTUNUS_BIOMETRIC_SAVE_CONFIRM";
export const BIOMETRIC_SAVE_CONFIRM_ENV_OFF = "0";
export const BIOMETRIC_UNLOCK_LABEL = "Unlock with biometrics";
export const BIOMETRIC_WAITING_LABEL = "Waiting for biometrics…";
export const BIOMETRIC_OR_PASSWORD = "or use your master password";
export const BIOMETRIC_REMOVE_LABEL = "Remove biometric unlock";
export const BIOMETRIC_REMOVE_CONFIRM =
  "Remove biometric unlock from this device? You'll unlock with your master password here.";
export const BIOMETRIC_UNLOCK_FAILED_MESSAGE =
  "Biometric unlock didn't work. Try again or use your master password.";
export const BIOMETRIC_STALE_MESSAGE =
  "Biometric unlock needs to be set up again — the master password changed. Unlock with your password, then enable it in Security.";
export const BIOMETRIC_SECTION_TITLE = "Biometric unlock";
export const BIOMETRIC_SECTION_HELP =
  "Unlock on this device with its fingerprint, face or screen lock instead of typing the master password. A copy of the vault key is kept on this device only, encrypted by a passkey. The master password still works everywhere and is still needed for these security settings. Changing it turns biometric unlock off on every device.";
export const BIOMETRIC_ENABLE_LABEL = "Enable biometric unlock";
export const BIOMETRIC_ENABLED_SINCE = "On for this device since ";
export const BIOMETRIC_NEEDS_KEYFILE =
  "Install the keyfile in this browser to use biometric unlock here.";
export const BIOMETRIC_RESET_BY_PASSWORD =
  "The password change turned biometric unlock off. Enable it again below.";
export const BIOMETRIC_ENABLE_FAILED = "Couldn't enable biometric unlock. Try again.";
export const BIOMETRIC_ENABLE_UNSUPPORTED =
  "This authenticator can't do biometric unlock (it lacks the PRF extension).";
export const BIOMETRIC_PASSWORD_LABEL = "Master password — required to enable";
export const BIOMETRIC_OFFER_TEXT = "Unlock with biometrics next time?";
export const BIOMETRIC_OFFER_ENABLE = "Set up";
export const BIOMETRIC_OFFER_DISMISS = "Not now";
export const BIOMETRIC_CONFIRM_SAVE_LABEL = "Confirm with biometrics";
export const BIOMETRIC_SAVE_FAILED_MESSAGE =
  "Biometric check didn't work. Try again or enter your master password.";
export const BIOMETRIC_SAVE_NEEDS_PASSWORD =
  "This save upgrades the vault's encryption — enter your master password.";
export const WRONG_PASSWORD_MESSAGE = "Wrong password.";

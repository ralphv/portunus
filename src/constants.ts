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
// files.generateIds: reserves the vault's file id before it is written, so
// the very first write is already signed for that id.
export const DRIVE_GENERATE_IDS_PATH = "/files/generateIds";
export const DRIVE_GENERATE_IDS_SPACE = "drive";

// --- Vault signatures (src/lib/signing.ts) ---
// Domain tags prefixed to the signed message. v2: payload + totp block
// (legacy, verify-only). v3: Drive file id + payload + optional totp block —
// every signature written now. Both are refused as PUT contents.
export const WRAPPER_SIGNATURE_CONTEXT_V2 = "portunus-vault-wrapper:v2\n";
export const WRAPPER_SIGNATURE_CONTEXT_V3 = "portunus-vault-wrapper:v3\n";
export const WRAPPER_SIGNATURE_RESERVED_PREFIXES: readonly string[] = [
  WRAPPER_SIGNATURE_CONTEXT_V2,
  WRAPPER_SIGNATURE_CONTEXT_V3,
];
// The wrapper's `version` field for file-id-bound (v3) signatures. Absent
// means a legacy wrapper signed before the binding existed.
export const VAULT_WRAPPER_VERSION_BOUND = 3;
export const LOG_VAULT_REJECTED_SIGNATURE = "[vault] rejected vault: signature does not verify";
export const LOG_VAULT_REJECTED_FORMAT = "[vault] rejected vault: unverifiable format";
export const LOG_VAULT_ACCEPTED_UNSIGNED =
  "[vault] accepted unsigned vault (PORTUNUS_ALLOW_MISSING_SIGNATURE=1); it is signed on its next save";
export const LOG_VAULT_CREATE_ID_MISMATCH =
  "[vault] Drive did not keep the reserved file id; re-signing for the id it assigned";

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

// --- Lock timing (server env, read in src/lib/lock-env.ts and passed to the
// client as props) ---
// Idle auto-lock: locks after this long without activity (1 s up to the max).
export const AUTO_LOCK_SECONDS_ENV = "PORTUNUS_AUTO_LOCK_SECONDS";
export const AUTO_LOCK_SECONDS_DEFAULT = 5 * 60;
export const AUTO_LOCK_SECONDS_MIN = 1;
// Hidden-page lock: while the page is hidden (tab switched, app in the
// background, screen off) the vault is blurred behind a lock badge, and
// locks once it has been hidden this long (0 = at once).
export const HIDDEN_LOCK_SECONDS_ENV = "PORTUNUS_HIDDEN_LOCK_SECONDS";
export const HIDDEN_LOCK_SECONDS_DEFAULT = 30;
export const HIDDEN_LOCK_SECONDS_MIN = 0;
// While hidden past the grace period but held off (unsaved changes being
// saved, app-opened UI), how often to check again.
export const HIDDEN_LOCK_RECHECK_MS = 5_000;
// Upper bound for either value: one day.
export const LOCK_SECONDS_MAX = 24 * 60 * 60;
// Followed by the variable's name — never its value.
export const LOG_LOCK_SECONDS_INVALID =
  "[config] not a whole number of seconds in range, using the default:";

// --- Argon2id KDF cost (server env, read in src/lib/kdf-env.ts and passed to
// the client as props; the engine's hardcoded defaults are the fallback). The
// cost is stored per-vault in the envelope, so these set it only for newly
// written wraps — existing vaults keep their stored cost until re-wrapped.
// Raising either value makes every unlock do more work, which slows an
// offline password-cracking attack by the same factor (see README). Bounds
// mirror the engine's own caps so a configured value is always acceptable to
// the KDF param parser. ---
// Passes over memory (iterations): a linear cost multiplier.
export const KDF_TIME_ENV = "PORTUNUS_KDF_TIME";
export const KDF_TIME_DEFAULT = 2;
export const KDF_TIME_MIN = 1;
export const KDF_TIME_MAX = 16;
// Memory filled per hash, in MiB: the anti-GPU/ASIC lever (the attacker must
// provision this much fast memory for every parallel guess).
export const KDF_MEM_MIB_ENV = "PORTUNUS_KDF_MEM_MIB";
export const KDF_MEM_MIB_DEFAULT = 128;
export const KDF_MEM_MIB_MIN = 8;
export const KDF_MEM_MIB_MAX = 256;
// Followed by the variable's name — never its value.
export const LOG_KDF_PARAM_INVALID =
  "[config] not a whole number in range, using the default:";
export const HIDDEN_COVER_CAPTION = "Hidden while you're away";
// Unlock progress (src/components/unlock-progress.tsx).
export const UNLOCK_PROGRESS_TITLE = "Unlocking your vault…";
export const UNLOCK_STAGE_FETCH = "Fetching your encrypted vault";
export const UNLOCK_STAGE_DERIVE = "Deriving your key";

// --- Password strength (zxcvbn score 0–4), shown for entry passwords and for
// the master password at create / change time. ---
export const STRENGTH_LABELS = [
  "Very weak",
  "Weak",
  "Fair",
  "Strong",
  "Excellent",
];
// Master-password soft-block: a score below this warns and asks for an
// explicit confirmation, but never hard-blocks (the keyfile stays the second
// factor, and a hard wall pushes people toward predictable patterns).
export const MASTER_PASSWORD_MIN_SCORE = 2;
export const PASSWORD_TOO_SHORT = "Use at least 8 characters.";
export const PASSWORDS_DONT_MATCH = "Passwords do not match.";
export const NEW_PASSWORDS_DONT_MATCH = "New passwords don't match.";
export const MASTER_PASSWORD_WEAK_WARNING =
  "This password is weak and could be guessed. Choose a stronger one, or use it anyway.";
export const MASTER_PASSWORD_USE_ANYWAY = "Use weak password";
// Settings dialog: the focus-loss trigger (settings.blurOnFocusLoss).
export const SETTING_BLUR_ON_FOCUS_LOSS_LABEL = "Blur when the window loses focus";
export const SETTING_BLUR_ON_FOCUS_LOSS_INFO =
  "Clicking another app or window, the address bar, or opening Recent apps " +
  "on a phone blurs the vault and starts the same countdown as switching " +
  "tabs. Turn this off to keep the vault readable beside other windows; " +
  "switching tabs, minimising or leaving the app still blurs and locks it. " +
  "Applies right away; Save to keep it.";

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
export const API_ERROR_PAYLOAD_TOO_LARGE = "payload_too_large";
export const API_ERROR_DRIVE = "drive_error";
export const API_ERROR_DRIVE_AUTH = "drive_auth";
export const LOG_STORE_ERROR = "[vault] store error";

// --- Request body limits (src/lib/read-limited-body.ts) ---
export const HTTP_STATUS_PAYLOAD_TOO_LARGE = 413;
// PUT /api/vault: the contents (≤ MAX_VAULT_BYTES characters of envelope
// JSON, mostly base64 ciphertext, so escaping adds only a few bytes) plus the
// small JSON frame around it (fileId, baseModifiedTime, totp).
export const VAULT_PUT_BODY_MAX_BYTES = MAX_VAULT_BYTES + 64 * 1024;
// POST /api/vault/unlock: { code, deliver } only.
export const VAULT_UNLOCK_BODY_MAX_BYTES = 4 * 1024;

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
// v2: the record's wrap key is derived from the passkey's PRF secret AND the
// keyfile bytes, so the keyfile is needed to decrypt it, not just checked.
export const DEVICE_UNLOCK_VERSION = 2;
// Older record versions still parse, but only so they can be reported as
// stale (set biometric unlock up again) and their passkeys forgotten.
export const DEVICE_UNLOCK_LEGACY_VERSIONS: readonly number[] = [1];
// HKDF-SHA256 `info` for the wrap key derived from the PRF output.
export const DEVICE_UNLOCK_HKDF_INFO = "portunus-device-unlock-v2";
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
  "Biometric unlock needs to be set up again — the master password or its security changed. Unlock with your password, then enable it in Security.";
export const BIOMETRIC_SECTION_TITLE = "Biometric unlock";
export const BIOMETRIC_SECTION_HELP =
  "Unlock on this device with its fingerprint, face or screen lock instead of typing the master password. A copy of the vault key is kept on this device only, encrypted by a passkey together with the keyfile, so the keyfile is still needed. The master password still works everywhere and is still needed for these security settings. Changing it turns biometric unlock off on every device.";
export const BIOMETRIC_ENABLE_LABEL = "Enable biometric unlock";
export const BIOMETRIC_ENABLED_SINCE = "On for this device since ";
export const BIOMETRIC_NEEDS_KEYFILE =
  "Install the keyfile in this browser to use biometric unlock here.";
export const BIOMETRIC_RESET_BY_PASSWORD =
  "The password change turned biometric unlock off. Enable it again below.";
export const BIOMETRIC_ENABLE_FAILED =
  "Couldn't enable biometric unlock. Try again — details are in the browser console.";
export const BIOMETRIC_ENABLE_CANCELLED =
  "The check was cancelled, timed out or refused by the authenticator. Try again.";
// Diagnostics for a failed check (browser console): which WebAuthn step
// failed and the browser's error name — never key material.
export const LOG_BIOMETRIC_FAILED = "[biometric] check failed:";
export const BIOMETRIC_STEP_CREATE = "create";
export const BIOMETRIC_STEP_GET = "get";
export const BIOMETRIC_DETAIL_NO_PRF_AT_CREATE = "authenticator reports no PRF (hmac-secret) support";
export const BIOMETRIC_DETAIL_NO_PRF_AT_GET = "authenticator returned no PRF output";
export const BIOMETRIC_DETAIL_NO_CREDENTIAL = "browser returned no credential";
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

// --- Service worker (public/sw.js, src/components/register-sw.tsx) ---
// Its caches are named `portunus-shell-<build>`; dev mode removes them.
export const SW_CACHE_PREFIX = "portunus-shell-";

// --- Vault header (src/components/vault-open.tsx) ---
// The lock button next to Save (icon only; this is its accessible name).
export const LOCK_BUTTON_LABEL = "Lock";

export const LOCK_UNSAVED_CONFIRM = "You have unsaved changes — lock anyway?";

// --- Theme (src/components/theme-switcher.tsx, src/app/layout.tsx,
// src/app/manifest.ts) ---
export const THEME_GROUP_LABEL = "Theme";
export const THEME_SYSTEM_LABEL = "System";
export const THEME_LIGHT_LABEL = "Light";
export const THEME_DARK_LABEL = "Dark";
// Copies of palette roles (src/app/palette.css) for places CSS can't reach:
// each scheme's surface, for <meta name="theme-color"> (browser / PWA
// chrome) and the manifest. Written by scripts/gen-palette.mjs;
// src/lib/palette.test.ts checks them.
export const THEME_COLOR_LIGHT = "#faf8ff";
export const THEME_COLOR_DARK = "#11131c";
export const THEME_MEDIA_LIGHT = "(prefers-color-scheme: light)";
export const THEME_MEDIA_DARK = "(prefers-color-scheme: dark)";
// An explicit Light/Dark choice adds one theme-color meta of its own, first
// in <head> so it wins over Next's per-media ones (src/lib/theme.ts).
export const THEME_COLOR_META_NAME = "theme-color";
export const THEME_COLOR_META_ID = "portunus-theme-color";
// Custom property carrying a brand icon's hex to .brand-icon (globals.css).
export const BRAND_COLOR_PROPERTY = "--brand";

// --- Response headers (src/lib/csp.ts, src/lib/security-headers.ts) ---
// Where Auth.js's fallback sign-in form is redirected to (CSP form-action).
export const GOOGLE_ACCOUNTS_ORIGIN = "https://accounts.google.com";
// HSTS is sent only when AUTH_URL (the app's public origin) is https://.
export const AUTH_URL_ENV = "AUTH_URL";
export const HTTPS_URL_PREFIX = "https://";
export const HSTS_HEADER = "strict-transport-security";
// One year; no includeSubDomains/preload: a self-hoster's other hosts are
// not this app's to pin.
export const HSTS_VALUE = "max-age=31536000";
export const NOSNIFF_HEADER = "x-content-type-options";
export const NOSNIFF_VALUE = "nosniff";
export const REFERRER_POLICY_HEADER = "referrer-policy";
export const REFERRER_POLICY_VALUE = "no-referrer";
export const PERMISSIONS_POLICY_HEADER = "permissions-policy";
// Off: hardware and sensors the app never uses. The QR scanner reads an
// image file, not the camera. Same-origin only: clipboard writes (copy
// buttons) and WebAuthn (biometric unlock).
export const PERMISSIONS_POLICY_VALUE = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "hid=()",
  "bluetooth=()",
  "midi=()",
  "clipboard-write=(self)",
  "publickey-credentials-get=(self)",
  "publickey-credentials-create=(self)",
].join(", ");

// Entry editor: the label input's list of existing labels (shown while the
// input has focus) and the + Add button.
export const EXISTING_LABELS_LABEL = "Existing labels";
export const MATCHING_LABELS_LABEL = "Matching labels";
export const ADD_EXISTING_LABEL_PREFIX = "Add label ";
export const CREATE_LABEL_HINT_PREFIX = "Press Enter to add ";
export const quoteLabel = (label: string) => `“${label}”`;
export const ADD_ENTRY_LABEL = "+ Add";
export const ADD_ENTRY_BLANK_HINT =
  "Fill in or close the new entry before adding another";

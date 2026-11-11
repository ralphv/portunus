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

// Pastes and up/down fire no edit event, so we poll.
export const POLL_MS = 200;
// After this long with no change, check less often.
export const IDLE_AFTER_MS = 3_000;
export const IDLE_POLL_MS = 1_000;
// A PNG newer than this is a fresh paste; older means history or undo.
export const PASTE_WINDOW_MS = 5_000;
export const MAX_DRAFTS = 50;
// Used until the thumbnails have rendered once.
export const DEFAULT_COLUMNS = 80;
// fs.read's limit.
export const READ_CAP_BYTES = 4 * 1024 * 1024;

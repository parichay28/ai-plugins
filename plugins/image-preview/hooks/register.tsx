import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { Preview, Size } from "../types";
import { CARD_ROWS, PANE_BORDER_COLUMNS, PANE_ID } from "../ui/constants";
import { Thumbnail } from "../ui/Thumbnail";
import { paneRows } from "../ui/utils";
import { PreviewPane } from "../ui/PreviewPane";
import {
  DEFAULT_COLUMNS,
  IDLE_AFTER_MS,
  IDLE_POLL_MS,
  MAX_DRAFTS,
  PASTE_WINDOW_MS,
  POLL_MS,
  READ_CAP_BYTES,
} from "./constants";
import { imageIds, isSwap, pngSize, removesImage, touchedIds } from "./utils";

// Pastes live at <tmp>/<project>/<session>/images/<N>.png; history.jsonl says which
// session sent a prompt. Untraceable tokens get no preview. `$` and atoms must stay here.

const previews = atom({ plugin: "image-preview", key: "previews" }, []);
// Whole preview, not just the id: #N can mean different files across sessions.
const selection = atom({ plugin: "image-preview", key: "selection" }, null);
const hovered = atom({ plugin: "image-preview", key: "hovered" }, null);

type Owners = Map<number, string>;
type HistoryEntry = {
  display: string;
  project: string;
  sessionId: string;
  timestamp: number;
};

let timer: { cancel: () => void } | undefined;
let pollMs = POLL_MS;
let idleTicks = 0;
let isSyncing = false;
let tmpDir: string | undefined;
let lastDraft: string | undefined;
// `/clear` changes the session without firing session.start.
let lastSession: string | undefined;
let lastOwners: Owners = new Map();
// So up/down back to an unsent draft keeps its previews.
const seenDrafts = new Map<string, Owners>();
// Pane was open and up/down hit a prompt with no images; reopen on the next one.
let isFollowing = false;
// Pane needs a height before it renders, so size it off the prompt width.
let promptColumns = DEFAULT_COLUMNS;
let historyCache: { mtimeMs: number; entries: HistoryEntry[] } | undefined;
const cacheDirs = new Map<string, string>();
const sizes = new Map<string, Size | null>();

async function cacheDir($: EngineInterface, sessionId: string) {
  const cached = cacheDirs.get(sessionId);
  if (cached !== undefined) return cached;

  if (tmpDir === undefined) {
    const configured = await $.env.get("CLAUDE_CODE_TMPDIR");
    tmpDir = configured ?? `/tmp/claude-${(await $.process.run(["id", "-u"])).stdout.trim()}`;
  }
  // Project folder name can go stale if the dir moved, so search by session id.
  const entries = await $.fs.list(tmpDir).catch(() => []);
  for (const entry of entries) {
    const dir = `${tmpDir}/${entry.name}/${sessionId}/images`;
    if (entry.kind === "dir" && (await $.fs.exists(dir))) {
      cacheDirs.set(sessionId, dir);
      return dir;
    }
  }
  return undefined;
}

async function isFreshPaste($: EngineInterface, sessionId: string, id: number) {
  const dir = await cacheDir($, sessionId);
  if (dir === undefined) return false;
  const stat = await $.fs.stat(`${dir}/${id}.png`).catch(() => undefined);
  return stat?.kind === "file" && (await $.clock.now()) - stat.mtimeMs < PASTE_WINDOW_MS;
}

async function readHistory($: EngineInterface) {
  const home = await $.env.get("HOME");
  if (home === undefined) return [];
  const path = `${home}/.claude/history.jsonl`;
  const stat = await $.fs.stat(path).catch(() => undefined);
  if (stat === undefined) return [];
  if (historyCache?.mtimeMs === stat.mtimeMs) return historyCache.entries;

  // Too big for fs.read; recent prompts are at the end anyway.
  const text = await (
    stat.size <= READ_CAP_BYTES
      ? $.fs.read(path)
      : $.process.run(["tail", "-c", String(READ_CAP_BYTES), path]).then(({ stdout }) => stdout)
  ).catch(() => undefined);
  // Don't cache a failed read.
  if (text === undefined) return historyCache?.entries ?? [];

  const entries: HistoryEntry[] = [];
  for (const line of text.split("\n")) {
    try {
      const entry = JSON.parse(line);
      if (
        typeof entry.display === "string" &&
        typeof entry.sessionId === "string" &&
        typeof entry.project === "string" &&
        typeof entry.timestamp === "number" &&
        entry.display.includes("[Image #")
      )
        entries.push(entry);
    } catch {
      // Partial line from a write in progress or the tail cut.
    }
  }
  historyCache = { mtimeMs: stat.mtimeMs, entries };
  return entries;
}

const AMBIGUOUS = Symbol("ambiguous");

// Same text from several sessions: only trust it if all their images are identical.
// An unreadable one could be the real sender, so that's ambiguous too.
async function findSender($: EngineInterface, text: string, ids: number[]) {
  const project = await $.session.root();
  const sent = (await readHistory($)).filter(
    (entry) => entry.display === text && entry.project === project,
  );
  const sessions = [
    ...new Set(sent.toSorted((a, b) => b.timestamp - a.timestamp).map((entry) => entry.sessionId)),
  ];
  if (sessions.length <= 1) return sessions[0];

  let firstFiles: string[] | undefined;
  for (const session of sessions) {
    const dir = await cacheDir($, session);
    if (dir === undefined) return AMBIGUOUS;
    const files = await Promise.all(
      ids.map((id) =>
        $.fs.read(`${dir}/${id}.png`, { as: "bytes" }).then(
          ({ base64 }) => base64,
          () => undefined,
        ),
      ),
    );
    const readable = files.filter((file) => file !== undefined);
    if (readable.length < ids.length) return AMBIGUOUS;
    const expected = firstFiles ?? readable;
    if (readable.some((file, i) => file !== expected[i])) return AMBIGUOUS;
    firstFiles = expected;
  }
  return sessions[0];
}

function setOwner(owners: Owners, id: number, owner: string | undefined) {
  if (owner !== undefined) owners.set(id, owner);
}

async function pastedIds($: EngineInterface, session: string, ids: number[]) {
  const fresh = await Promise.all(ids.map((id) => isFreshPaste($, session, id)));
  return ids.filter((_, i) => fresh[i]);
}

// Fresh pastes first, otherwise matching history could hand them to another session.
async function imageOwners($: EngineInterface, before: string | undefined, after: string) {
  const owners: Owners = new Map();
  const ids = imageIds(after);
  if (ids.length === 0) return owners;
  const thisSession = await $.session.id();
  const touched = before === undefined ? ids : touchedIds(before, after);
  const untouched = ids.filter((id) => !touched.includes(id));

  // Removing a token means swap or undo, not a paste.
  if (before !== undefined && !removesImage(before, after))
    for (const id of await pastedIds($, thisSession, touched)) owners.set(id, thisSession);
  const unowned = ids.filter((id) => !owners.has(id));
  if (unowned.length === 0) return owners;
  const assignUnowned = (owner: string, to = unowned) => {
    for (const id of to) owners.set(id, owner);
    return owners;
  };

  const remembered = seenDrafts.get(after);
  if (remembered !== undefined) {
    for (const id of unowned) setOwner(owners, id, remembered.get(id));
    return owners;
  }

  const sender = await findSender($, after, unowned);
  if (sender === AMBIGUOUS) return owners;
  if (sender !== undefined) {
    // Small edit matching another session's prompt: up/down or typing? Can't tell,
    // so show nothing.
    const isConflict =
      before !== undefined &&
      !isSwap(before, after) &&
      untouched.some((id) => lastOwners.has(id) && lastOwners.get(id) !== sender);
    return isConflict ? owners : assignUnowned(sender);
  }

  // Sessions start empty, so whatever's there on first look is ours.
  if (before === undefined) return assignUnowned(thisSession);

  // Keep owners of untouched tokens; new untraceable ones get nothing.
  for (const id of untouched) setOwner(owners, id, lastOwners.get(id));
  return owners;
}

async function toPreview(
  $: EngineInterface,
  id: number,
  owner: string,
): Promise<Preview | undefined> {
  const dir = await cacheDir($, owner);
  if (dir === undefined) return undefined;
  const file = `${dir}/${id}.png`;
  const stat = await $.fs.stat(file).catch(() => undefined);
  if (stat?.kind !== "file") return undefined;

  if (!sizes.has(file)) {
    const size = await $.fs.read(file, { as: "bytes" }).then(
      ({ base64 }) => pngSize(base64),
      () => null, // too big to read; draw at a default shape
    );
    sizes.set(file, size);
  }
  return {
    id,
    file,
    size: sizes.get(file) ?? null,
    bytes: stat.size,
    pastedAt: stat.mtimeMs,
    session: owner,
    isThisSession: owner === (await $.session.id()),
  };
}

// focus: false when following up/down, so typing stays in the prompt.
async function openPane(
  $: EngineInterface,
  preview: Preview,
  columns: number,
  { focus = true } = {},
) {
  await update($, selection, () => preview);
  await $.ui.open({
    id: PANE_ID,
    title: `Image #${preview.id}`,
    ...(focus ? { focus: true } : {}),
    closeOnEscape: true,
    rows: paneRows(preview, columns - PANE_BORDER_COLUMNS),
  });
}

// Clear selection before closing so a late sync can't reopen it.
async function closePane($: EngineInterface) {
  await update($, selection, () => null);
  await $.ui.close({ id: PANE_ID });
}

async function syncPane($: EngineInterface, before: string, text: string, updated: Preview[]) {
  const selected = await read($, selection);
  const first = updated[0];
  const swapped = isSwap(before, text);

  if (text.trim() === "") {
    isFollowing = false;
    if (selected !== null) await closePane($);
    return;
  }
  if (selected === null) {
    if (!isFollowing) return;
    // Typing here means they've stopped cycling.
    if (!swapped) isFollowing = false;
    else if (first !== undefined) await openPane($, first, promptColumns, { focus: false });
    return;
  }
  if (first === undefined) {
    await closePane($);
    isFollowing = swapped;
    return;
  }
  const isGone = !updated.some(
    (preview) => preview.id === selected.id && preview.file === selected.file,
  );
  // Might have been closed while we were reading files.
  if ((isGone || swapped) && (await read($, selection)) !== null)
    await openPane($, first, promptColumns, { focus: false });
}

async function syncPreviews($: EngineInterface) {
  // A slow history read can overlap the next tick.
  if (isSyncing) return;
  isSyncing = true;
  try {
    const session = await $.session.id();
    if (session !== lastSession) {
      lastSession = session;
      forgetDrafts();
    }
    const { text } = await $.prompt.read();
    if (text === lastDraft) {
      idleTicks += 1;
      if (pollMs === POLL_MS && idleTicks * POLL_MS >= IDLE_AFTER_MS) setPollRate($, IDLE_POLL_MS);
      return;
    }
    setPollRate($, POLL_MS);

    const before = lastDraft;
    const owners = await imageOwners($, before, text);
    lastDraft = text;
    lastOwners = owners;
    if (owners.size > 0) {
      // Re-insert to keep LRU order.
      seenDrafts.delete(text);
      seenDrafts.set(text, owners);
      if (seenDrafts.size > MAX_DRAFTS) {
        const [oldest] = seenDrafts.keys();
        if (oldest !== undefined) seenDrafts.delete(oldest);
      }
    }

    const updated: Preview[] = [];
    for (const id of imageIds(text)) {
      const owner = owners.get(id);
      const preview = owner === undefined ? undefined : await toPreview($, id, owner);
      if (preview !== undefined) updated.push(preview);
    }
    if (JSON.stringify(await read($, previews)) !== JSON.stringify(updated))
      await update($, previews, () => updated);

    await syncPane($, before ?? "", text, updated);
  } finally {
    isSyncing = false;
  }
}

function startPolling($: EngineInterface) {
  if (timer === undefined) setPollRate($, POLL_MS);
}

function setPollRate($: EngineInterface, ms: number) {
  idleTicks = 0;
  if (timer !== undefined && pollMs === ms) return;
  timer?.cancel();
  pollMs = ms;
  timer = $.clock.every(ms, () => syncPreviews($));
}

function forgetDrafts() {
  lastOwners = new Map();
  seenDrafts.clear();
  isFollowing = false;
}

function reset() {
  timer?.cancel();
  timer = undefined;
  pollMs = POLL_MS;
  idleTicks = 0;
  lastDraft = undefined;
  lastSession = undefined;
  forgetDrafts();
}

// CLI only: every hook matches `surface: "terminal"`, so none run in desktop, IDE or mobile.
export const register: Register = (on) => {
  on("session.start", { surface: "terminal", isInteractive: true }, ($, e, next) => {
    reset();
    startPolling($);
    return next(e);
  });

  on("ui.render", { component: "AbovePrompt", surface: "terminal" }, async ($, e, next) => {
    // In case session.start didn't run for this instance.
    startPolling($);

    const shown = await read($, previews);
    if (shown.length === 0 || e.props.hasSurvey || e.props.maxRows < CARD_ROWS) return next(e);

    promptColumns = e.props.bodyColumns;
    return Thumbnail($.ui.resolve(e), {
      previews: shown,
      columns: e.props.bodyColumns,
      hovered: await read($, hovered),
      isOpen: (await read($, selection)) !== null,
    });
  });

  // Typing wakes polling straight away, so a paste right after shows quickly.
  on("prompt.edit", ($, e, next) => {
    if (timer !== undefined) setPollRate($, POLL_MS);
    return next(e);
  });

  on("ui.message", { component: "AbovePrompt", surface: "terminal" }, async ($, e, next) => {
    const message = e.data;
    if (typeof message !== "object" || message === null) return next(e);
    if ("hover" in message)
      await update($, hovered, () => (typeof message.hover === "number" ? message.hover : null));
    if ("open" in message && typeof message.open === "number") {
      const id = message.open;
      const preview = (await read($, previews)).find((other) => other.id === id);
      const selected = await read($, selection);
      if (selected !== null && selected.id === id && selected.file === preview?.file)
        await closePane($);
      else if (preview !== undefined) await openPane($, preview, promptColumns);
    }
    return {};
  });

  on(
    "ui.render",
    { component: "Pane", requestId: PANE_ID, surface: "terminal" },
    async ($, e, next) => {
      const preview = await read($, selection);
      if (preview === null) return next(e);

      const columns = e.props.bodyColumns;
      const shown = await read($, previews);
      const index = Math.max(
        0,
        shown.findIndex((other) => other.id === preview.id && other.file === preview.file),
      );
      return PreviewPane($.ui.resolve(e), {
        preview,
        index,
        count: shown.length,
        columns,
        rows: e.props.scroll.bodyRows,
        onStep: (step) => {
          const other = shown[(index + step + shown.length) % shown.length];
          if (other !== undefined) void openPane($, other, columns);
        },
      });
    },
  );

  on("ui.close", async ($, e, next) => {
    if (e.id === PANE_ID) {
      isFollowing = false;
      await update($, selection, () => null);
    }
    return next(e);
  });
};

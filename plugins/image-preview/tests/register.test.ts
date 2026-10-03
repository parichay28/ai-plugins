import type { On } from "claude-code";
import type { Engine, EngineCall, MountTarget } from "claude-code/testing";
import { expect, mock, test } from "claude-code/testing";
import { HOVER_COLOR, OPEN_COLOR } from "../ui/constants";

const TMP_DIR = "/tmp/claude-501";
const THIS = "session-this";
const OTHER = "session-other";

const ABOVE_PROMPT: MountTarget<"terminal", "AbovePrompt"> = {
  plugin: "image-preview",
  surface: "terminal",
  component: "AbovePrompt",
  requestId: "above-prompt",
  viewport: { columns: 120, rows: 40 },
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
};

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return btoa(String.fromCharCode(...bytes));
}

function cacheDir(session: string) {
  return `${TMP_DIR}/-work/${session}/images`;
}

const HISTORY = "/home/me/.claude/history.jsonl";

// Fake cache for two sessions plus history.jsonl. `big` paths fail fs.read.
function setup(
  on: On,
  files: Record<string, number>,
  history: object[] = [],
  { bytes = {}, big = [] }: { bytes?: Record<string, string>; big?: string[] } = {},
) {
  const clock = mock.clock(on, { now: 100_000 });
  const draft = { text: "" };
  const session = { value: THIS };
  const historyText = () => history.map((h) => JSON.stringify(h)).join("\n");

  mock.env(on, { CLAUDE_CODE_TMPDIR: TMP_DIR, HOME: "/home/me" });
  on("session.start", () => ({ cwd: "/work" }));
  on("session.id", () => ({ value: session.value }));
  on("session.root", () => ({ value: "/work" }));
  on("prompt.read", () => ({ value: { text: draft.text, cursor: draft.text.length } }));
  on("fs.list", () => ({
    value: [{ name: "-work", kind: "dir", size: 0, mtimeMs: 0, isLink: false }],
  }));
  on("fs.exists", ($, e) => ({
    value: e.path === cacheDir(THIS) || e.path === cacheDir(OTHER) || e.path in files,
  }));
  on("fs.stat", ($, e) => {
    const mtimeMs = e.path === HISTORY ? 1 : files[e.path];
    if (mtimeMs === undefined) throw new Error("ENOENT");
    const size = big.includes(e.path) ? 5 * 1024 * 1024 : 10;
    return { value: { kind: "file", size, mtimeMs, isLink: false } };
  });
  on("fs.read", ($, e) => {
    if (big.includes(e.path)) throw new Error("over the read cap");
    if (e.path === HISTORY) return { value: historyText() };
    if (!(e.path in files)) throw new Error("ENOENT");
    return { value: { base64: bytes[e.path] ?? pngHeader(800, 400) } };
  });
  on("ui.render", () => ({ type: "Text", props: {}, children: ["engine thumbnails"] }));

  on("process.run", ($, e) => {
    const isTail = e.argv[0] === "tail" && e.argv.at(-1) === HISTORY;
    return {
      value: {
        exitCode: isTail ? 0 : 1,
        stdout: isTail ? historyText() : "",
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });

  return { clock, draft, session };
}

async function start($: Engine) {
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
}

async function thumbnailFiles($: Engine) {
  const ui = await $.ui.mount({ ...ABOVE_PROMPT, surface: "terminal" });
  const images = await ui.findAll({ type: "Image" });
  await ui.unmount();
  // Thumbnails only, not the pane image.
  return images
    .filter((image) => image.key?.startsWith("image-"))
    .flatMap(({ props: { source } }) =>
      typeof source === "object" && source !== null && "file" in source ? [source.file] : [],
    );
}

test("a fresh paste shows this session's cached image, and clears with the draft", async ($, on) => {
  const { clock, draft } = setup(on, {
    [`${cacheDir(THIS)}/4.png`]: 100_100,
    [`${cacheDir(OTHER)}/4.png`]: 100_150,
  });
  await start($);
  await clock.advance(200);

  draft.text = "look [Image #4]";
  await clock.advance(200);
  expect(await thumbnailFiles($)).toEqual([`${cacheDir(THIS)}/4.png`]);

  draft.text = "";
  await clock.advance(200);
  expect(await thumbnailFiles($)).toEqual([]);
});

test("a prompt recalled with up/down shows the images of the session that sent it", async ($, on) => {
  const text = "[Image #2] why is this broken";
  const { clock, draft } = setup(
    on,
    { [`${cacheDir(THIS)}/2.png`]: 1, [`${cacheDir(OTHER)}/2.png`]: 1 },
    [{ display: text, project: "/work", sessionId: OTHER, timestamp: 5 }],
  );
  await start($);
  await clock.advance(200);

  draft.text = text;
  await clock.advance(200);
  expect(await thumbnailFiles($)).toEqual([`${cacheDir(OTHER)}/2.png`]);
});

test("identical prompts from two sessions show only when their images agree", async ($, on) => {
  const text = "[Image #2] same words";
  const sent = [
    { display: text, project: "/work", sessionId: OTHER, timestamp: 5 },
    { display: text, project: "/work", sessionId: THIS, timestamp: 6 },
  ];
  const files = { [`${cacheDir(THIS)}/2.png`]: 1, [`${cacheDir(OTHER)}/2.png`]: 1 };
  const { clock, draft } = setup(on, files, sent, {
    bytes: {
      [`${cacheDir(OTHER)}/2.png`]: pngHeader(10, 10),
    },
  });
  await start($);
  await clock.advance(200);

  // Different #2 in each session, so we can't tell which was recalled.
  draft.text = text;
  await clock.advance(200);
  expect(await thumbnailFiles($)).toEqual([]);
});

test("identical prompts show nothing when one session's image can't be read", async ($, on) => {
  const text = "[Image #2] same words";
  const sent = [
    { display: text, project: "/work", sessionId: OTHER, timestamp: 5 },
    { display: text, project: "/work", sessionId: THIS, timestamp: 6 },
  ];
  // THIS's copy is gone, but it might still be the sender.
  const { clock, draft } = setup(on, { [`${cacheDir(OTHER)}/2.png`]: 1 }, sent);
  await start($);
  await clock.advance(200);

  draft.text = text;
  await clock.advance(200);
  expect(await thumbnailFiles($)).toEqual([]);
});

test("a swapped-in draft with no traceable sender shows nothing", async ($, on) => {
  const { clock, draft } = setup(on, { [`${cacheDir(THIS)}/2.png`]: 1 });
  await start($);
  await clock.advance(200);

  // Not in history and not a fresh paste.
  draft.text = "[Image #2]";
  await clock.advance(200);
  expect(await thumbnailFiles($)).toEqual([]);
});

test("a fresh paste shows this session's image though another session sent the same text", async ($, on) => {
  const files = { [`${cacheDir(THIS)}/1.png`]: 100_100, [`${cacheDir(OTHER)}/1.png`]: 1 };
  const sent = [{ display: "[Image #1]", project: "/work", sessionId: OTHER, timestamp: 5 }];
  const { clock, draft } = setup(on, files, sent);
  await start($);
  await clock.advance(200);

  draft.text = "[Image #1]";
  await clock.advance(200);
  expect(await thumbnailFiles($)).toEqual([`${cacheDir(THIS)}/1.png`]);
});

test("up/down to a near-identical prompt from another session shows neither image", async ($, on) => {
  const files = { [`${cacheDir(THIS)}/1.png`]: 1, [`${cacheDir(OTHER)}/1.png`]: 1 };
  const sent = [
    { display: "[Image #1] fix", project: "/work", sessionId: OTHER, timestamp: 5 },
    { display: "[Image #1] fix the bug", project: "/work", sessionId: THIS, timestamp: 6 },
  ];
  const { clock, draft } = setup(on, files, sent);
  await start($);
  await clock.advance(200);
  draft.text = "[Image #1] fix the bug";
  await clock.advance(200);
  expect(await thumbnailFiles($)).toEqual([`${cacheDir(THIS)}/1.png`]);

  // Could be up/down or deleting " the bug", can't tell.
  draft.text = "[Image #1] fix";
  await clock.advance(200);
  expect(await thumbnailFiles($)).toEqual([]);
});

test("a /clear forgets the drafts the previous session saw", async ($, on) => {
  const files = { [`${cacheDir(OTHER)}/1.png`]: 100_100, [`${cacheDir(THIS)}/1.png`]: 100_100 };
  const { clock, draft, session } = setup(on, files);
  session.value = OTHER;
  await start($);
  await clock.advance(200);
  draft.text = "[Image #1]";
  await clock.advance(200);
  expect(await thumbnailFiles($)).toEqual([`${cacheDir(OTHER)}/1.png`]);

  draft.text = "";
  await clock.advance(200);
  session.value = THIS;
  draft.text = "[Image #1]";
  await clock.advance(200);
  expect(await thumbnailFiles($)).toEqual([`${cacheDir(THIS)}/1.png`]);
});

test("recall works when history.jsonl is over the read cap", async ($, on) => {
  const sent = [{ display: "[Image #2] x", project: "/work", sessionId: OTHER, timestamp: 5 }];
  const { clock, draft } = setup(on, { [`${cacheDir(OTHER)}/2.png`]: 1 }, sent, {
    big: ["/home/me/.claude/history.jsonl"],
  });
  await start($);
  await clock.advance(200);

  draft.text = "[Image #2] x";
  await clock.advance(200);
  expect(await thumbnailFiles($)).toEqual([`${cacheDir(OTHER)}/2.png`]);
});

test("an untraceable token leaves the other previews in place", async ($, on) => {
  const files = { [`${cacheDir(THIS)}/1.png`]: 100_100, [`${cacheDir(THIS)}/3.png`]: 1 };
  const { clock, draft } = setup(on, files);
  await start($);
  await clock.advance(200);
  draft.text = "[Image #1] look";
  await clock.advance(200);
  await clock.advance(10_000);

  draft.text = "[Image #1] look, as in [Image #3]";
  await clock.advance(200);
  expect(await thumbnailFiles($)).toEqual([`${cacheDir(THIS)}/1.png`]);
});

test("a recalled prompt with a fresh paste added shows both", async ($, on) => {
  const files = { [`${cacheDir(OTHER)}/2.png`]: 1, [`${cacheDir(THIS)}/5.png`]: 100_500 };
  const sent = [{ display: "[Image #2] x", project: "/work", sessionId: OTHER, timestamp: 5 }];
  const { clock, draft } = setup(on, files, sent);
  await start($);
  await clock.advance(200);
  draft.text = "[Image #2] x";
  await clock.advance(200);

  draft.text = "[Image #2] x [Image #5]";
  await clock.advance(200);
  expect(await thumbnailFiles($)).toEqual([`${cacheDir(OTHER)}/2.png`, `${cacheDir(THIS)}/5.png`]);
});

test("an unsent draft keeps its previews after cycling away and back", async ($, on) => {
  const { clock, draft } = setup(
    on,
    { [`${cacheDir(THIS)}/7.png`]: 100_100, [`${cacheDir(OTHER)}/1.png`]: 1 },
    [{ display: "[Image #1] older", project: "/work", sessionId: OTHER, timestamp: 5 }],
  );
  await start($);
  await clock.advance(200);
  draft.text = "[Image #7]";
  await clock.advance(200);

  // Up to an old prompt, then down back to the draft much later.
  draft.text = "[Image #1] older";
  await clock.advance(10_000);
  expect(await thumbnailFiles($)).toEqual([`${cacheDir(OTHER)}/1.png`]);

  draft.text = "[Image #7]";
  await clock.advance(200);
  expect(await thumbnailFiles($)).toEqual([`${cacheDir(THIS)}/7.png`]);
});

test("clicking anywhere on a card paneOpens the preview pane with the picture and its details", async ($, on) => {
  const { clock, draft } = setup(on, { [`${cacheDir(THIS)}/4.png`]: 100_100 });
  const paneOpens: object[] = [];
  on("ui.open", ($, e) => {
    paneOpens.push(e);
    return { value: { isPlaced: true } };
  });
  await start($);
  await clock.advance(200);
  draft.text = "[Image #4]";
  await clock.advance(200);

  const thumbnails = await $.ui.mount({ ...ABOVE_PROMPT, surface: "terminal" });
  // Hover highlights, click opens.
  expect(JSON.stringify(await thumbnails.drawn())).not.toContain(HOVER_COLOR);
  await thumbnails.pointer({ type: "enter", x: 0, y: 0 });
  expect(JSON.stringify(await thumbnails.drawn())).toContain(HOVER_COLOR);
  await thumbnails.pointer({ type: "down", x: 6, y: 2, button: "left" });
  await thumbnails.pointer({ type: "up", x: 6, y: 2, button: "left" });
  expect(paneOpens).toMatchObject([
    { id: "image-preview", title: "Image #4", focus: true, closeOnEscape: true },
  ]);

  const pane = await $.ui.mount({
    plugin: "image-preview",
    surface: "terminal",
    component: "Pane",
    requestId: "image-preview",
    viewport: { columns: 120, rows: 40 },
    props: {
      title: "Image #4",
      isFocused: true,
      bodyColumns: 100,
      placement: "inline",
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  });
  expect(await pane.find({ key: "pane-image" })).toBeDefined();
  expect(await pane.find({ type: "Text", text: "800 × 400 px · 10 B" })).toBeDefined();
  expect(await pane.find({ type: "Text", text: "this session (session-)" })).toBeDefined();
});

const RECALLED = "[Image #2] then [Image #7] why is this broken";

async function openPreview($: Engine, on: On) {
  const { clock, draft } = setup(
    on,
    {
      [`${cacheDir(THIS)}/4.png`]: 100_100,
      [`${cacheDir(OTHER)}/2.png`]: 1,
      [`${cacheDir(OTHER)}/7.png`]: 1,
    },
    [{ display: RECALLED, project: "/work", sessionId: OTHER, timestamp: 5 }],
  );
  const closed: string[] = [];
  const paneOpens: { title?: string; focus?: true }[] = [];
  on("ui.open", ($, e) => {
    paneOpens.push(e);
    return { value: { isPlaced: true } };
  });
  on("ui.close", ($, e) => {
    closed.push(e.id);
    return { value: undefined };
  });
  await start($);
  await clock.advance(200);
  draft.text = "look at [Image #4]";
  await clock.advance(200);
  const thumbnails = await $.ui.mount({ ...ABOVE_PROMPT, surface: "terminal" });
  await thumbnails.pointer({ type: "up", x: 1, y: 1, button: "left" });
  return { clock, draft, closed, paneOpens, thumbnails };
}

test("the pane stays open while the draft is edited", async ($, on) => {
  const { clock, draft, closed } = await openPreview($, on);
  draft.text = "look at [Image #4] please";
  await clock.advance(200);
  expect(closed).toEqual([]);
});

test("the pane closes when the prompt is cleared", async ($, on) => {
  const { clock, draft, closed } = await openPreview($, on);
  draft.text = "";
  await clock.advance(200);
  expect(closed).toEqual(["image-preview"]);
});

test("up/down to a prompt with images moves the pane to its first, keeping the keys", async ($, on) => {
  const { clock, draft, closed, paneOpens } = await openPreview($, on);
  draft.text = RECALLED;
  await clock.advance(200);
  expect(closed).toEqual([]);
  expect(paneOpens.at(-1)).toMatchObject({ title: "Image #2" });
  expect(paneOpens.at(-1)?.focus).toBeUndefined();
});

test("up/down past a prompt without images closes the pane until one with images", async ($, on) => {
  const { clock, draft, closed, paneOpens } = await openPreview($, on);
  draft.text = "fix the flaky login test";
  await clock.advance(200);
  expect(closed).toEqual(["image-preview"]);

  const before = paneOpens.length;
  draft.text = "and make the build green again";
  await clock.advance(200);
  expect(paneOpens.length).toBe(before);

  draft.text = RECALLED;
  await clock.advance(200);
  expect(paneOpens.at(-1)).toMatchObject({ title: "Image #2" });
  expect(paneOpens.at(-1)?.focus).toBeUndefined();
});

test("editing a prompt without images ends the pane following up/down", async ($, on) => {
  const { clock, draft, paneOpens } = await openPreview($, on);
  draft.text = "fix the flaky login test";
  await clock.advance(200);
  draft.text = "fix the flaky login test now";
  await clock.advance(200);
  const before = paneOpens.length;
  draft.text = RECALLED;
  await clock.advance(200);
  expect(paneOpens.length).toBe(before);
});

test("clicking the card on show closes the pane, and the hint says so", async ($, on) => {
  const { closed, thumbnails } = await openPreview($, on);
  expect(
    await thumbnails.find({ type: "Text", text: "click preview again to close" }),
  ).toBeDefined();
  await thumbnails.pointer({ type: "up", x: 1, y: 1, button: "left" });
  expect(closed).toEqual(["image-preview"]);
});

test("n and p on a clicked card step the pane while the prompt keeps its text", async ($, on) => {
  const { clock, draft } = setup(on, {
    [`${cacheDir(THIS)}/4.png`]: 100_100,
    [`${cacheDir(THIS)}/5.png`]: 100_500,
  });
  const titles: (string | undefined)[] = [];
  on("ui.open", ($, e) => {
    titles.push(e.title);
    return { value: { isPlaced: true } };
  });
  await start($);
  await clock.advance(200);
  draft.text = "[Image #4] [Image #5]";
  await clock.advance(200);
  const thumbnails = await $.ui.mount({ ...ABOVE_PROMPT, surface: "terminal" });
  await thumbnails.pointer({ type: "up", x: 1, y: 1, button: "left", in: "clickable-4" });
  await thumbnails.key({ key: "n", in: "clickable-4" });
  await thumbnails.key({ key: "n", in: "clickable-4" });
  await thumbnails.key({ key: "p", in: "clickable-4" });
  expect(titles).toEqual(["Image #4", "Image #5", "Image #4", "Image #5"]);
  // The card on show stays lit after the pointer leaves.
  await thumbnails.pointer({ type: "leave", x: 0, y: 0, in: "clickable-4" });
  const colors = async () =>
    (await thumbnails.findAll({ type: "Text" }))
      .filter((text) => text.text.startsWith("#"))
      .map((text) => `${text.text} ${text.props.color}`);
  expect(await colors()).toEqual(["#4 undefined", `#5 ${OPEN_COLOR}`]);
  // Hovering another card lights it a step dimmer, and the open one stays lit.
  await thumbnails.pointer({ type: "enter", x: 0, y: 0, in: "clickable-4" });
  expect(await colors()).toEqual([`#4 ${HOVER_COLOR}`, `#5 ${OPEN_COLOR}`]);
});

test("moving the cursor onto an image token highlights its thumbnail", async ($, on) => {
  const { clock, draft } = setup(on, {
    [`${cacheDir(THIS)}/4.png`]: 100_100,
    [`${cacheDir(THIS)}/5.png`]: 100_500,
  });
  // The editor's own splice; tests can't otherwise raise prompt.edit.
  on("prompt.edit", ($, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }));
  await start($);
  await clock.advance(200);
  draft.text = "[Image #4] and [Image #5]";
  await clock.advance(200);
  const edit = ($.prompt as unknown as { edit: EngineCall<"prompt.edit"> }).edit;
  const thumbnails = await $.ui.mount({ ...ABOVE_PROMPT, surface: "terminal" });
  const highlighted = async () =>
    (await thumbnails.findAll({ type: "Text" }))
      .filter((text) => text.props.color === HOVER_COLOR)
      .map((text) => text.text);
  const moveTo = (cursor: number) =>
    edit({
      origin: { kind: "composer" },
      text: draft.text,
      cursor: 0,
      start: cursor,
      end: cursor,
      inputText: "",
    });

  expect(await highlighted()).toEqual([]);
  await moveTo(20);
  expect(await highlighted()).toEqual(["#5"]);
  await moveTo(12);
  expect(await highlighted()).toEqual([]);
  await moveTo(10);
  expect(await highlighted()).toEqual(["#4"]);
});

test("a pane closed by clearing the prompt stays closed when an image is pasted again", async ($, on) => {
  const { clock, draft } = setup(on, {
    [`${cacheDir(THIS)}/4.png`]: 100_100,
    [`${cacheDir(THIS)}/5.png`]: 100_500,
  });
  const paneOpens: string[] = [];
  on("ui.open", ($, e) => {
    paneOpens.push(e.id);
    return { value: { isPlaced: true } };
  });
  on("ui.close", () => ({ value: undefined }));
  await start($);
  await clock.advance(200);
  draft.text = "[Image #4]";
  await clock.advance(200);
  const thumbnails = await $.ui.mount({ ...ABOVE_PROMPT, surface: "terminal" });
  await thumbnails.pointer({ type: "up", x: 1, y: 1, button: "left" });
  expect(paneOpens).toEqual(["image-preview"]);

  draft.text = "";
  await clock.advance(200);
  draft.text = "[Image #5]";
  await clock.advance(200);
  expect(paneOpens).toEqual(["image-preview"]);
});

test("polling slows down when idle and catches a paste within a second", async ($, on) => {
  const { clock, draft } = setup(on, { [`${cacheDir(THIS)}/1.png`]: 104_000 });
  await start($);
  await clock.advance(4_000);

  draft.text = "[Image #1]";
  await clock.advance(100);
  expect(await thumbnailFiles($)).toEqual([]);
  await clock.advance(900);
  expect(await thumbnailFiles($)).toEqual([`${cacheDir(THIS)}/1.png`]);
});

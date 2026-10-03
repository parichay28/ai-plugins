import { expect, test } from "claude-code/testing";

import { imageIds, isSwap, pngSize, touchedIds } from "../hooks/utils";
import { fitCells } from "../ui/utils";

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return btoa(String.fromCharCode(...bytes));
}

test("image ids come from the draft, deduplicated, in order", () => {
  expect(imageIds("see [Image #2] and [Image #1], [Image #2]")).toEqual([2, 1]);
  expect(imageIds("[Image 1] [image #3] #4")).toEqual([]);
});

test("typing leaves tokens untouched; pastes and recalls touch theirs", () => {
  expect(touchedIds("see [Image #4]", "see [Image #4] now")).toEqual([]);
  expect(touchedIds("see [Image #4] now", "see [Image #4]")).toEqual([]);
  expect(touchedIds("see ", "see [Image #4]")).toEqual([4]);
  expect(touchedIds("", "look [Image #4]")).toEqual([4]);
  // Shared `[Image #` prefix still counts.
  expect(touchedIds("[Image #7]", "[Image #1] older")).toEqual([1]);
  // Backspacing into a token breaks it.
  expect(touchedIds("[Image #4]", "[Image #4")).toEqual([]);
});

test("pictures fit the fixed card area at their own shape", () => {
  // Square: full height, 2x columns.
  expect(fitCells({ width: 500, height: 500 }, 12, 3)).toEqual({ columns: 6, rows: 3 });
  // A wide screenshot: full width, fewer rows.
  expect(fitCells({ width: 2000, height: 420 }, 12, 3)).toEqual({ columns: 12, rows: 1 });
  // Tall: full height, narrow.
  expect(fitCells({ width: 100, height: 2000 }, 12, 3)).toEqual({ columns: 1, rows: 3 });
});

test("PNG size is read from the IHDR header", () => {
  expect(pngSize(pngHeader(1630, 632))).toEqual({ width: 1630, height: 632 });
  expect(pngSize(btoa("not a png at all, just some text"))).toBeNull();
});

test("a recalled prompt replaces the draft; typing and deleting edit it", () => {
  expect(isSwap("look at [Image #4]", "fix the login bug [Image #2]")).toBe(true);
  expect(isSwap("look at [Image #4]", "look at [Image #4] please")).toBe(false);
  expect(isSwap("look at [Image #4] please", "look at [Image #4]")).toBe(false);
  expect(isSwap("look at [Image #4]", "look at [Image #4")).toBe(false);
});

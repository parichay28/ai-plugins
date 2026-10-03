import type { Preview, Size, ThumbnailInput } from "../types";

const IMAGE_TOKEN = /\[Image #(\d+)\]/g;

export function imageIds(text: string): number[] {
  return [...new Set([...text.matchAll(IMAGE_TOKEN)].map((match) => Number(match[1])))];
}

// The token the cursor is in or right next to.
export function idAtCursor(text: string, cursor: number): number | null {
  const token = [...text.matchAll(IMAGE_TOKEN)].find(
    (match) => match.index <= cursor && cursor <= match.index + match[0].length,
  );
  return token === undefined ? null : Number(token[1]);
}

// Trim common prefix/suffix; good enough for keystrokes and whole-prompt swaps.
function diff(before: string, after: string) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  return { start, end: after.length - end, removed: before.slice(start, before.length - end) };
}

// Up/down has no event, so guess: most of the text replaced at once.
export function isSwap(before: string, after: string) {
  const { start, end, removed } = diff(before, after);
  const kept = start + (after.length - end);
  return removed.length > 0 && end > start && kept * 2 < Math.max(before.length, after.length);
}

// Counts partly-overlapping tokens too, so a recall can't inherit old owners.
export function touchedIds(before: string, after: string): number[] {
  const { start, end } = diff(before, after);
  const touched = [...after.matchAll(IMAGE_TOKEN)].filter((match) => {
    const tokenEnd = match.index + match[0].length;
    // Pure deletion: the token around the cursor counts.
    return start === end
      ? match.index < start && start < tokenEnd
      : match.index < end && start < tokenEnd;
  });
  return [...new Set(touched.map((match) => Number(match[1])))];
}

export function removesImage(before: string, after: string) {
  return imageIds(diff(before, after).removed).length > 0;
}

// Width/height straight from the PNG header.
export function pngSize(base64: string): Size | null {
  // First 32 base64 chars = 24 bytes = signature + IHDR size.
  const header = Uint8Array.from(atob(base64.slice(0, 32)), (char) => char.charCodeAt(0));
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (header.length < 24 || signature.some((byte, i) => header[i] !== byte)) return null;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

// Same token number can point at another session's file.
export function isSamePreview(a: Preview, b: Preview) {
  return a.id === b.id && a.file === b.file;
}

export function isThumbnailInput(data: unknown): data is ThumbnailInput {
  return typeof data === "object" && data !== null && "id" in data && typeof data.id === "number";
}

import type { Preview, Size } from "../types";
import { CELL_ASPECT, CHROME_ROWS, MAX_IMAGE_ROWS, PANE_PADDING_COLUMNS } from "./constants";

export function fitCells(size: Size | null, columns: number, rows: number) {
  const { width, height } = size ?? { width: 16, height: 10 };
  if ((columns * height) / (rows * CELL_ASPECT * width) > 1) {
    return {
      columns: Math.max(1, Math.round((rows * CELL_ASPECT * width) / height)),
      rows,
    };
  }
  return {
    columns,
    rows: Math.max(1, Math.round((columns * height) / (CELL_ASPECT * width))),
  };
}

// `columns` is the pane's body width.
export function paneRows(preview: Preview, columns: number) {
  return fitCells(preview.size, columns - PANE_PADDING_COLUMNS, MAX_IMAGE_ROWS).rows + CHROME_ROWS;
}

export function formatPasted(at: number, now: number) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  const time = new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (seconds < 60) return `just now · ${time}`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago · ${time}`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago · ${time}`;
  return `${new Date(at).toLocaleDateString()} · ${time}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

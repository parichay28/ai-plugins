// One pane, reused for every image.
export const PANE_ID = "image-preview";
// Pane rows other than the image: padding, title, gaps, details card, key hints.
export const CHROME_ROWS = 11;
export const MAX_IMAGE_ROWS = 30;
export const LABEL_COLUMNS = 12;
// Engine border, and our own side padding.
export const PANE_BORDER_COLUMNS = 2;
export const PANE_PADDING_COLUMNS = 2;

// Fixed size so the row doesn't jump around.
export const IMAGE_COLUMNS = 12;
export const IMAGE_ROWS = 3;
export const CARD_COLUMNS = IMAGE_COLUMNS + 2;
export const CARD_ROWS = IMAGE_ROWS + 3;

// Same white, the open card a step brighter than a hovered one.
export const OPEN_COLOR = "whiteBright";
export const HOVER_COLOR = "white";

// No hide button: Claude Code's `[-]` already collapses this area.
export const HINT = "click preview to enlarge";
export const OPEN_HINT = "click preview again to close";
export const HINT_COLUMNS = Math.max(HINT.length, OPEN_HINT.length) + 1;

// Terminal cells are ~2x taller than wide.
export const CELL_ASPECT = 2;

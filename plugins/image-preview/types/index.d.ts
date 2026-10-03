export type Size = { width: number; height: number };

export type Preview = {
  /** N of the `[Image #N]` token. */
  id: number;
  /** Cached PNG in the owning session. */
  file: string;
  /** Null if the file was too big to read. */
  size: Size | null;
  bytes: number;
  /** File mtime, i.e. paste time. */
  pastedAt: number;
  session: string;
  isThisSession: boolean;
};

export type ThumbnailInput = {
  id: number;
  hovered: boolean;
  /** Resent with every post until the next action, so a hover update can't swallow a click. */
  action?: { type: "click" | "next" | "previous"; nonce: number };
};

declare module "claude-code" {
  interface PluginState {
    "image-preview": {
      previews: Preview[];
      selection: Preview | null;
      hovered: number | null;
      atCursor: number | null;
    };
  }
}

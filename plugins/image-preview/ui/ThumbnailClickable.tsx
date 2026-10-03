import type { ClientModule } from "claude-code";

type Props = { id: number };

// Invisible overlay: only a Client gets pointer events, so it forwards them.
const ThumbnailClickable: ClientModule<Props> = ({ id }, surface) => {
  surface.onPointer((event) => {
    if (event.type === "up" && event.button === "left") surface.post({ open: id });
    if (event.type === "enter") surface.post({ hover: id });
    if (event.type === "leave") surface.post({ hover: null });
  });
  return surface.elements.Box({ width: surface.columns, height: surface.rows });
};

export default ThumbnailClickable;

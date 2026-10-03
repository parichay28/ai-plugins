import type { ClientModule } from "claude-code";

import type { ThumbnailInput } from "../types";

type Props = { id: number };
type Action = NonNullable<ThumbnailInput["action"]>["type"];

// Only Clients get mouse events, so this sits invisibly on top of a thumbnail.
const ThumbnailClickable: ClientModule<Props, ThumbnailInput> = ({ id }, surface) => {
  let input: ThumbnailInput = { id, hovered: false };
  const send = (change: Partial<ThumbnailInput>) => {
    input = { ...input, ...change };
    surface.post(input);
  };
  const act = (type: Action) => send({ action: { type, nonce: Math.random() } });

  surface.onPointer((event) => {
    if (event.type === "up" && event.button === "left") act("click");
    if (event.type === "enter") send({ hovered: true });
    if (event.type === "leave") send({ hovered: false });
  });
  // After a click the keys land here, not in the pane.
  surface.onKey((event) => {
    if (event.key === "n") act("next");
    if (event.key === "p") act("previous");
  });
  return surface.elements.Box({ width: surface.columns, height: surface.rows });
};

export default ThumbnailClickable;

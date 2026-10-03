import type { ElementTable } from "claude-code";

import type { Preview } from "../types";
import {
  IMAGE_COLUMNS,
  IMAGE_ROWS,
  CARD_COLUMNS,
  CARD_ROWS,
  HINT,
  OPEN_HINT,
  HINT_COLUMNS,
  OPEN_COLOR,
  HOVER_COLOR,
} from "./constants";
import { fitCells } from "./utils";

type Props = {
  previews: Preview[];
  columns: number;
  highlighted: number | null;
  // The card shown in the pane stays lit whatever else is hovered.
  openId: number | null;
};

export function Thumbnail(
  { Box, Client, Image, Text }: ElementTable<"terminal">,
  { previews, columns, highlighted, openId }: Props,
) {
  // Drop the hint on narrow terminals so at least one card fits.
  const hasHint = columns >= HINT_COLUMNS + CARD_COLUMNS;
  const room = columns - (hasHint ? HINT_COLUMNS : 0);
  const slots = Math.max(1, Math.floor((room + 1) / (CARD_COLUMNS + 1)));
  // Last slot becomes "+N more" when there's overflow.
  const visible = previews.slice(0, previews.length > slots ? Math.max(1, slots - 1) : slots);
  const hidden = previews.length - visible.length;

  return (
    <Box flexDirection="row" justifyContent="space-between" height={CARD_ROWS}>
      <Box flexDirection="row" gap={1}>
        {visible.map((preview) => {
          const color =
            preview.id === openId
              ? OPEN_COLOR
              : preview.id === highlighted
                ? HOVER_COLOR
                : undefined;
          const isHighlighted = color !== undefined;
          return (
            <Box key={`card-${preview.id}`} width={CARD_COLUMNS} height={CARD_ROWS}>
              <Box
                flexDirection="column"
                alignItems="center"
                width={CARD_COLUMNS}
                height={CARD_ROWS}
                borderStyle="round"
                borderColor={color}
                borderDimColor={!isHighlighted}
              >
                <Box
                  width={IMAGE_COLUMNS}
                  height={IMAGE_ROWS}
                  alignItems="center"
                  justifyContent="center"
                >
                  <Image
                    key={`image-${preview.id}`}
                    source={{ file: preview.file, format: "png" }}
                    {...fitCells(preview.size, IMAGE_COLUMNS, IMAGE_ROWS)}
                    alt={`[Image #${preview.id}]`}
                  />
                </Box>
                <Text color={color} dimColor={!isHighlighted}>
                  #{preview.id}
                </Text>
              </Box>
              {/* Clicks need a Client, which can't draw images, so it sits on top. */}
              <Box position="absolute" top={0} left={0} width={CARD_COLUMNS} height={CARD_ROWS}>
                <Client
                  key={`clickable-${preview.id}`}
                  module="./ThumbnailClickable.tsx"
                  props={{ id: preview.id }}
                  width={CARD_COLUMNS}
                  height={CARD_ROWS}
                />
              </Box>
            </Box>
          );
        })}
        {hidden > 0 && (
          <Box
            key="more"
            width={CARD_COLUMNS}
            height={CARD_ROWS}
            alignItems="center"
            justifyContent="center"
            borderStyle="round"
            borderDimColor
          >
            <Text dimColor>+{hidden} more</Text>
          </Box>
        )}
      </Box>
      {hasHint && (
        <Box
          flexDirection="column"
          justifyContent="flex-end"
          alignItems="flex-end"
          width={HINT_COLUMNS}
        >
          <Text dimColor>{openId !== null ? OPEN_HINT : HINT}</Text>
        </Box>
      )}
    </Box>
  );
}

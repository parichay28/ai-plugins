import type { ElementTable } from "claude-code";

import type { Preview } from "../types";
import { CHROME_ROWS, LABEL_COLUMNS, PANE_PADDING_COLUMNS } from "./constants";
import { fitCells, formatBytes, formatPasted } from "./utils";

type Props = {
  preview: Preview;
  index: number;
  count: number;
  columns: number;
  rows: number;
  onStep: (step: number) => void;
};

function details(preview: Preview): [string, string][] {
  const dimensions =
    preview.size === null ? null : `${preview.size.width} × ${preview.size.height} px`;
  const session = preview.session.slice(0, 8);
  return [
    ["Size", [dimensions, formatBytes(preview.bytes)].filter(Boolean).join(" · ")],
    ["Pasted", formatPasted(preview.pastedAt, Date.now())],
    [
      "Session",
      preview.isThisSession ? `this session (${session})` : `an earlier one (${session})`,
    ],
    ["File", preview.file],
  ];
}

// Image fills whatever space the details leave.
export function PreviewPane(
  { Box, Button, Image, Text }: ElementTable<"terminal">,
  { preview, index, count, columns, rows, onStep }: Props,
) {
  const image = fitCells(
    preview.size,
    columns - PANE_PADDING_COLUMNS,
    Math.max(4, rows - CHROME_ROWS),
  );

  return (
    <Box flexDirection="column" paddingX={1} paddingTop={1} height={rows}>
      {/* Keep clear of the engine's × button. */}
      <Box flexDirection="row" gap={1} paddingRight={2}>
        <Text bold>Image #{preview.id}</Text>
        {count > 1 && (
          <Text dimColor>
            · {index + 1} of {count}
          </Text>
        )}
      </Box>
      <Box flexGrow={1} alignItems="center" justifyContent="center" marginY={1}>
        <Image
          key="pane-image"
          source={{ file: preview.file, format: "png" }}
          {...image}
          alt={`[Image #${preview.id}]`}
        />
      </Box>
      <Box flexDirection="column" flexShrink={0} borderStyle="round" borderDimColor paddingX={1}>
        {details(preview).map(([label, value]) => (
          <Box key={label} flexDirection="row">
            <Box width={LABEL_COLUMNS} flexShrink={0}>
              <Text dimColor>{label}</Text>
            </Box>
            {/* The end of the path is the useful part. */}
            <Text wrap={label === "File" ? "truncate-start" : "truncate"}>{value}</Text>
          </Box>
        ))}
      </Box>
      <Box flexDirection="row" gap={3} flexShrink={0}>
        <Text dimColor>
          <Text bold>esc</Text> close
        </Text>
        {count > 1 && (
          <Button
            key="previous"
            label="previous"
            plain
            dimColor
            hotkey="p"
            onPress={() => onStep(-1)}
          />
        )}
        {count > 1 && (
          <Button key="next" label="next" plain dimColor hotkey="n" onPress={() => onStep(1)} />
        )}
      </Box>
    </Box>
  );
}

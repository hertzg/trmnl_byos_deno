/** @jsxImportSource hono/jsx */
import type { DeviceReport } from "../../src/plugin/plugin.ts";
import type { Board } from "./bvg/board_assembler.ts";
import BoardView from "./bvg/Board.tsx";

// The view's input. Slim by design — only the fields rendered into HTML live
// here, so identical state → identical HTML → identical filename → Device
// skips the e-ink refresh (ADR-0004). The board carries its own row-level
// timestamps; chrome is static.
export type FrameData = {
  board: Board;
  device: DeviceReport | null;
};

// Battery shell + fill + percent text. Renders nothing when the device hasn't
// reported a battery voltage yet (first poll after boot, or non-battery
// clients like the local /preview view).
function Battery({ device }: { device: DeviceReport | null }) {
  if (!device || device.batteryPercent == null) return null;
  return (
    <span class="battery" title={`${device.batteryVoltage?.toFixed(2)} V`}>
      <span class="battery__shell">
        <span
          class="battery__fill"
          style={`width: ${device.batteryPercent}%`}
        />
      </span>
      <span class="battery__pct">{device.batteryPercent}%</span>
    </span>
  );
}

export default function DefaultTemplate({ board, device }: FrameData) {
  // The footer used to carry "next update HH:MM (+Ns)" and the head a
  // "updated HH:MM" stamp. Both ticked between refreshes, forcing the
  // e-ink panel to repaint every cycle for no information gain — battery
  // drain. Pure static chrome now; rows carry their own timestamps.
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <title>trmnl-byos-deno</title>
        <link rel="stylesheet" href="/assets/style.css" />
      </head>
      <body>
        <BoardView board={board} />
        <footer class="title-bar">
          <span class="title-bar__title">trmnl-byos-deno</span>
          <span class="title-bar__instance">ტრანსპორტი</span>
          <Battery device={device} />
        </footer>
      </body>
    </html>
  );
}

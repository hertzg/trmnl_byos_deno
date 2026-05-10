/** @jsxImportSource hono/jsx */
import type { DeviceState } from "../../src/device.ts";
import type { FrameData } from "./data.ts";
import Board from "./bvg/Board.tsx";
import { formatHHMM } from "./bvg/time.ts";

// Battery shell + fill + percent text. Renders nothing when the device hasn't
// reported a battery voltage yet (first poll after boot, or non-battery clients
// like the local /preview view).
function Battery({ device }: { device: DeviceState }) {
  if (device.batteryPercent == null) return null;
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

function formatRefreshIn(from: Date, until: Date): string {
  const secs = Math.max(0, Math.round((until.getTime() - from.getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

export default function DefaultTemplate(
  { board, fetchedAt, device, nextRefreshAt }: FrameData,
) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <title>trmnl-byos-deno</title>
        <link rel="stylesheet" href="/assets/style.css" />
      </head>
      <body>
        <Board board={board} />
        <footer class="title-bar">
          <span class="title-bar__title">trmnl-byos-deno</span>
          <span class="title-bar__instance">
            ტრანსპორტი
            {" · "}
            შემდეგი განახლება {formatHHMM(nextRefreshAt)}{" "}
            (+{formatRefreshIn(fetchedAt, nextRefreshAt)})
          </span>
          <Battery device={device} />
        </footer>
      </body>
    </html>
  );
}

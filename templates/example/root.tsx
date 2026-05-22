/** @jsxImportSource hono/jsx */
import type { DeviceReport } from "../../src/plugin/plugin.ts";
import { BatteryIndicator } from "../ds/BatteryIndicator.tsx";
import { Content } from "../ds/Content.tsx";
import { Layout } from "../ds/Layout.tsx";
import { Page } from "../ds/Page.tsx";
import { StatusBar } from "../ds/StatusBar.tsx";
import type { Board } from "./bvg/board_assembler.ts";
import BoardView from "./bvg/Board.tsx";
import { formatKaDate } from "./bvg/time.ts";

// The view's input. Slim by design — only the fields rendered into HTML live
// here, so identical state → identical HTML → identical filename → Device
// skips the e-ink refresh (ADR-0004). The board carries its own row-level
// timestamps; chrome is mostly static (only `today` ticks, once per day).
export type FrameData = {
  board: Board;
  device: DeviceReport | null;
  // `ctx.t` from the run. Rendered in the footer as the date (no time). Day-
  // granular on purpose: a time-bearing footer would re-hash every minute and
  // burn an e-ink refresh per poll for no information gain.
  t: Temporal.ZonedDateTime;
};

// Footer date format. "ორშ, 18 მაი" — weekday, day, short month, all in
// Georgian. Day-only; the time is intentionally absent so the HTML identity
// is stable across every poll inside a single day. Built off the hand-rolled
// table in time.ts because Deno's Intl falls back to en-US for ka-GE.
function formatDate(t: Temporal.ZonedDateTime): string {
  return formatKaDate(new Date(t.toInstant().epochMilliseconds));
}

export default function DefaultTemplate({ board, device, t }: FrameData) {
  // The footer used to carry "next update HH:MM (+Ns)" and the head a
  // "updated HH:MM" stamp. Both ticked between refreshes, forcing the
  // e-ink panel to repaint every cycle for no information gain — battery
  // drain. Pure static chrome now; rows carry their own timestamps.
  return (
    <Page title="trmnl-byos-deno" stylesheet="/assets/style.css">
      <Layout>
        <Content>
          <BoardView board={board} />
        </Content>
        <StatusBar position="bottom">
          <span class="title-bar__title">trmnl-byos-deno</span>
          <span class="title-bar__date">{formatDate(t)}</span>
          <span class="title-bar__instance">ტრანსპორტი</span>
          <BatteryIndicator
            value={device?.batteryPercent ?? null}
            voltage={device?.batteryVoltage}
          />
        </StatusBar>
      </Layout>
    </Page>
  );
}

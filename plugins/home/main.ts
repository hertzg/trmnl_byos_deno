// Super-Plugin (plugins/home/). This is the deployed Plugin — the entry point
// wired into config/live/system.ts.
//
// It composes Notice, Transport, Gallery, and Sleep as plain code. On each
// `run` call it checks the notice thread first — a live notice beats
// everything — then whether we're in a sleep window (via activeWindowEnd). If
// so, returns the Sleep Result with validity set to the window's end time.
// Otherwise, awaits Transport and Gallery, delegates to compose.ts for routing
// and validity logic (including clamping to the next window start). The
// Conductor and Server see exactly one Plugin; the multi-leaf nesting is
// invisible.
//
// Importing @hztrmnl/transport intentionally starts Transport's background BVG
// refresh timer (setInterval in its module-level IIFE). That is expected and
// correct — the timer's lifecycle is bound to the Plugin's lifecycle.

import transport from "@hztrmnl/transport";
import gallery from "@hztrmnl/gallery";
import sleep from "@hztrmnl/sleep";
import notice from "@hztrmnl/notice";
import { compose } from "./compose.ts";
import { parseSleepWindows } from "./sleep-window.ts";
import { SLEEP_WINDOWS } from "@hztrmnl/config/plugins/home/sleep";
import type { Plugin, Result, RunContext } from "@hztrmnl/server/plugin";
import type { FrameData } from "@hztrmnl/transport";
import type { GalleryState } from "@hztrmnl/gallery";
import type { NoticeState } from "@hztrmnl/notice";

// SleepState is empty — the sleep view is constant and carries no data.
type SleepState = Record<string, never>;

// Parse sleep windows once at module load time.
// Throws on invalid config (e.g., from === until).
const parsedWindows = parseSleepWindows(SLEEP_WINDOWS);

export default {
  async run(
    ctx: RunContext,
  ): Promise<Result<FrameData | GalleryState | SleepState | NoticeState>> {
    return await compose(
      ctx.t,
      parsedWindows,
      () => transport.run(ctx),
      () => gallery.run(ctx),
      () => sleep.run(ctx),
      () => notice.run(ctx),
    );
  },
} satisfies Plugin<FrameData | GalleryState | SleepState | NoticeState>;

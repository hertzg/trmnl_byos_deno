// Super-Plugin (plugins/home/). This is the deployed Plugin — the entry point
// wired into config/live/system.ts.
//
// It composes Transport and Gallery as plain code: on each `run` call it awaits
// Transport, inspects the board's emptyReason, and delegates to compose.ts for
// the routing and validity logic. The Conductor and Server see exactly one
// Plugin; the Transport / Gallery nesting is invisible to them.
//
// Importing @hztrmnl/transport intentionally starts Transport's background BVG
// refresh timer (setInterval in its module-level IIFE). That is expected and
// correct — the timer's lifecycle is bound to the Plugin's lifecycle.

import transport from "@hztrmnl/transport";
import gallery from "@hztrmnl/gallery";
import { composeResult } from "./compose.ts";
import type { Plugin, Result, RunContext } from "@hztrmnl/server/plugin";
import type { FrameData } from "@hztrmnl/transport";
import type { GalleryState } from "@hztrmnl/gallery";

const home: Plugin<FrameData | GalleryState> = {
  async run(ctx: RunContext): Promise<Result<FrameData | GalleryState>> {
    return composeResult(await transport.run(ctx), () => gallery.run(ctx));
  },
};
export default home;

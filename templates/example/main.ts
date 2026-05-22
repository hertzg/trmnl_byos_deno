// Super-Plugin for templates/example/. This is the deployed Plugin — the entry
// point PluginManager loads when PLUGIN_DIR points to templates/example/.
//
// It composes Transport and Gallery as plain code: on each `run` call it awaits
// Transport, inspects the board's emptyReason, and delegates to compose.ts for
// the routing and validity logic. The Conductor and Server see exactly one
// Plugin; the Transport / Gallery nesting is invisible to them.
//
// Importing transport/main.ts intentionally starts Transport's background BVG
// refresh timer (setInterval in its module-level IIFE). That is expected and
// correct — the timer's lifecycle is bound to the Plugin's lifecycle.

import transport from "./transport/main.ts";
import gallery from "./gallery/main.ts";
import { composeResult } from "./compose.ts";
import type { Plugin, RunContext } from "../../src/plugin/plugin.ts";
import type { FrameData } from "./transport/root.tsx";
import type { GalleryState } from "./gallery/Gallery.tsx";

export default {
  async run(ctx: RunContext) {
    return composeResult(await transport.run(ctx), () => gallery.run(ctx));
  },
} satisfies Plugin<FrameData | GalleryState>;

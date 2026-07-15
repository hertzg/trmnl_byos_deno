import type { Plugin, Result, RunContext } from "@hztrmnl/server/plugin";
import Sleep from "./Sleep.tsx";

// Sleep plugin state is empty-ish: the view is constant, no data needed.
type SleepState = Record<string, never>;

// ADR-0002 module shape: default-export a Plugin object directly.
export default {
  run(_ctx: RunContext): Result<SleepState> {
    return {
      state: {},
      // Nominal 1-hour validity; home (Super-Plugin) overrides this with the
      // actual remaining window duration when showing the sleep screen.
      validity: Temporal.Duration.from({ hours: 1 }),
      view: Sleep,
    };
  },
} satisfies Plugin<SleepState>;

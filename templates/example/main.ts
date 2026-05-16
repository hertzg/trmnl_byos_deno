import type { Plugin, RunContext } from "../../src/plugin/plugin.ts";
import { boardValidForSeconds } from "./bvg/board_assembler.ts";
import { type FrameData, loadAll } from "./data.ts";
import DefaultTemplate from "./root.tsx";

function View(state: FrameData) {
  return DefaultTemplate(state);
}

export default function (): Plugin<FrameData> {
  return {
    async run(ctx: RunContext) {
      const data = await loadAll();
      const validSeconds = Math.max(1, boardValidForSeconds(data.board, data.fetchedAt));
      const validity = Temporal.Duration.from({ seconds: validSeconds });
      const nextRefreshAt = new Date(ctx.t.add(validity).toInstant().epochMilliseconds);
      return {
        state: { ...data, device: ctx.device, nextRefreshAt },
        validity,
        view: View,
      };
    },
  };
}

import type { Registration, SetupConfig } from "../../src/template/loader.ts";
import { boardValidForSeconds } from "./bvg/board_assembler.ts";
import { loadAll } from "./data.ts";
import Template from "./root.tsx";

export function setup({ getDevice }: SetupConfig): Registration {
  return {
    async onDisplay() {
      const data = await loadAll();
      const validForSeconds = boardValidForSeconds(data.board, data.fetchedAt);
      const nextRefreshAt = new Date(Date.now() + validForSeconds * 1000);
      return {
        jsx: Template({ ...data, device: getDevice(), nextRefreshAt }),
        validForSeconds,
      };
    },
  };
}

import type { Registration, SetupConfig } from "../../src/template/loader.ts";
import { loadAll } from "./data.ts";
import Template from "./root.tsx";

export function setup(_config: SetupConfig): Registration {
  return {
    async onDisplay() {
      return {
        jsx: Template(await loadAll()),
        validForSeconds: 60,
      };
    },
  };
}

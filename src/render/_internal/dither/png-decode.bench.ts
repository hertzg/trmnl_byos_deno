import { decodePNG } from "@img/png";
import { decodePngCdp } from "./png-decode.ts";

const FIXTURE = "scripts/fixtures/cdp-sample.png";
const bytes = await Deno.readFile(FIXTURE);

// @img/png consumes the input buffer; clone per iteration so back-to-back runs see
// the same starting state. The clone is also done for the specialized decoder so the
// comparison stays apples-to-apples.
Deno.bench({
  name: "@img/png decodePNG (baseline)",
  group: "png-decode",
  baseline: true,
  fn: async () => {
    await decodePNG(bytes.slice());
  },
});

Deno.bench({
  name: "decodePngCdp (specialized)",
  group: "png-decode",
  fn: async () => {
    await decodePngCdp(bytes.slice());
  },
});

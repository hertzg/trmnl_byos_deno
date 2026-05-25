// Compiles every `*.as.ts` under src/ to a sibling `.wasm` (+ `.wat`) via AssemblyScript.
// Convention: each kernel lives next to the TS that consumes it, with the AS source named
// `<kernel>.as.ts` and the wasm wrapper at `<kernel>.wasm.ts`. Run with `deno task build:wasm`.

import { walk } from "@std/fs/walk";

const ASC_FLAGS = [
  "-O3",
  "--runtime",
  "stub",
  "--use",
  "abort=",
  // SIMD enables v128 + f32x4 intrinsics used by the luma pass in dither.as.ts. The wasm SIMD
  // proposal is supported by every runtime we target (Deno/V8 since 2021).
  "--enable",
  "simd",
];
const ROOT = new URL("../src/", import.meta.url);

const sources: string[] = [];
for await (const entry of walk(ROOT, { exts: [".as.ts"], includeDirs: false })) {
  sources.push(entry.path);
}
sources.sort();

if (sources.length === 0) {
  console.error(`no *.as.ts files found under ${ROOT.pathname}`);
  Deno.exit(1);
}

for (const src of sources) {
  const base = src.slice(0, -".as.ts".length); // strip the suffix; asc re-adds .ts
  const wasm = `${base}.wasm`;
  const wat = `${base}.wat`;
  console.log(`asc ${src} -> ${wasm}`);
  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "-A",
      "npm:assemblyscript/asc",
      `${base}.as`,
      ...ASC_FLAGS,
      "-o",
      wasm,
      "-t",
      wat,
    ],
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await cmd.output();
  if (code !== 0) Deno.exit(code);
}

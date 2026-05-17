import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { loadPlugin } from "./loader.ts";

async function writeFixture(content: string): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "plugin-loader-test-" });
  await Deno.writeTextFile(join(dir, "main.ts"), content);
  return dir;
}

Deno.test("loadPlugin returns the module's default export as the Plugin, with no factory invocation", async () => {
  const dir = await writeFixture(`
    export default {
      run() {
        return {
          state: { ok: true },
          validity: Temporal.Duration.from({ minutes: 1 }),
          view: () => "<p>x</p>",
        };
      },
    };
  `);

  const plugin = await loadPlugin(dir);
  const result = await plugin.run({
    t: Temporal.ZonedDateTime.from("2026-05-16T10:00[Europe/Berlin]"),
    intent: "poll",
    device: null,
  });

  assertEquals(result.state, { ok: true });
});

Deno.test("loadPlugin throws a clear error when main.ts is missing", async () => {
  const dir = await Deno.makeTempDir({ prefix: "plugin-loader-test-" });
  await assertRejects(
    () => loadPlugin(dir),
    Error,
    "main.ts",
  );
});

Deno.test("loadPlugin throws a clear error when the module has no default export", async () => {
  const dir = await writeFixture(`export function notDefault() {}`);
  await assertRejects(
    () => loadPlugin(dir),
    Error,
    "default export",
  );
});

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { createConductor } from "../conductor/conductor.ts";
import type { Result } from "./plugin.ts";
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

Deno.test("loadPlugin throws a clear error when the default export is a function (legacy factory)", async () => {
  // Catches the common migration mistake: someone leaves the old
  // `export default function () { ... }` factory shape after the contract
  // moved to a Plugin-object default export.
  const dir = await writeFixture(`
    export default function () {
      return {
        run() {
          return {
            state: {},
            validity: Temporal.Duration.from({ minutes: 1 }),
            view: () => "",
          };
        },
      };
    }
  `);
  await assertRejects(
    () => loadPlugin(dir),
    Error,
    "Plugin object with a run method",
  );
});

Deno.test("loadPlugin throws a clear error when the default export has no run method", async () => {
  const dir = await writeFixture(`export default { notRun: 1 };`);
  await assertRejects(
    () => loadPlugin(dir),
    Error,
    "run method",
  );
});

Deno.test("a Plugin loaded via loadPlugin drives /api/display end-to-end", async () => {
  // Smoke test: prove the new contract round-trips through the Conductor.
  // Uses an on-disk fixture (not the real templates/example, which depends
  // on the user-private routes.ts) so the test is hermetic.
  const dir = await writeFixture(`
    export default {
      run(ctx) {
        return {
          state: { intent: ctx.intent },
          validity: Temporal.Duration.from({ seconds: 120 }),
          view: (s) => "<p>" + s.intent + "</p>",
        };
      },
    };
  `);
  const plugin = await loadPlugin(dir);

  const conductor = createConductor({
    plugin,
    deriveHtml: (r: Result<unknown>) => String(r.view(r.state)),
    identityFor: (html: string) => "id-" + html,
    errorView: (_err: Error) => "",
    errorValidity: Temporal.Duration.from({ seconds: 30 }),
    friendlyId: "SMOKE",
    pluginAssetsDir: "/tmp",
    now: () => Temporal.ZonedDateTime.from("2026-05-16T10:00[Europe/Berlin]"),
  });

  const res = await conductor.app.request("/api/display");
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.status, 0);
  assertEquals(body.filename, "image-id-<p>poll</p>");
  assertEquals(body.refresh_rate, 120);
});

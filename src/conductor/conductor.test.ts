import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { createConductor } from "./conductor.ts";
import type { Result } from "../plugin/plugin.ts";

const at = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[Europe/Berlin]`);
const fiveMin = Temporal.Duration.from({ minutes: 5 });

Deno.test("trigger returns the rasterized PNG for the Plugin's Result", async () => {
  const expectedPng = new Uint8Array([1, 2, 3]);

  const run = spy(() => ({
    state: { msg: "hi" },
    validity: fiveMin,
    view: (s: { msg: string }) => `<p>${s.msg}</p>`,
  }));
  const rasterize = spy(() => Promise.resolve(expectedPng));

  const conductor = createConductor({
    plugin: { run },
    renderer: {
      deriveHtml: (r: Result<{ msg: string }>) => String(r.view(r.state)),
      rasterize,
    },
    identityFor: () => "id",
  });

  const out = await conductor.trigger({ t: at("2026-05-16T10:00"), intent: "poll", device: {} });

  assertEquals(out.png, expectedPng);
  assertSpyCalls(run, 1);
  assertSpyCalls(rasterize, 1);
});

Deno.test("trigger inside the validity window reuses Current Image without re-invoking collaborators", async () => {
  const run = spy(() => ({
    state: {},
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));
  const deriveHtml = spy((r: Result<unknown>) => String(r.view(r.state)));
  const rasterize = spy(() => Promise.resolve(new Uint8Array([7])));

  const conductor = createConductor({
    plugin: { run },
    renderer: { deriveHtml, rasterize },
    identityFor: (html) => html,
  });

  const t0 = at("2026-05-16T10:00");
  const first = await conductor.trigger({ t: t0, intent: "poll", device: {} });
  const second = await conductor.trigger({ t: t0.add({ minutes: 1 }), intent: "poll", device: {} });
  const third = await conductor.trigger({ t: t0.add({ minutes: 4 }), intent: "poll", device: {} });

  assertSpyCalls(run, 1);
  assertSpyCalls(deriveHtml, 1);
  assertSpyCalls(rasterize, 1);
  assertEquals(second.png, first.png);
  assertEquals(third.png, first.png);
  assertEquals(second.identity, first.identity);
});

Deno.test("trigger after expiry skips rasterize and keeps Current Image when identity matches", async () => {
  const expectedPng = new Uint8Array([42]);

  const run = spy(() => ({
    state: {},
    validity: fiveMin,
    view: () => "<p>stable</p>",
  }));
  const deriveHtml = spy((r: Result<unknown>) => String(r.view(r.state)));
  const rasterize = spy(() => Promise.resolve(expectedPng));

  const conductor = createConductor({
    plugin: { run },
    renderer: { deriveHtml, rasterize },
    identityFor: () => "stable-identity",
  });

  const t0 = at("2026-05-16T10:00");
  const first = await conductor.trigger({ t: t0, intent: "poll", device: {} });
  const second = await conductor.trigger({ t: t0.add({ minutes: 6 }), intent: "poll", device: {} });

  assertSpyCalls(run, 2);
  assertSpyCalls(deriveHtml, 2);
  assertSpyCalls(rasterize, 1);
  assertEquals(second.png, first.png);
  assertEquals(second.identity, first.identity);
});

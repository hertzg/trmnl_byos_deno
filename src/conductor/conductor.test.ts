import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { createConductor } from "./conductor.ts";
import type { Result } from "../plugin/plugin.ts";

const at = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[Europe/Berlin]`);
const fiveMin = Temporal.Duration.from({ minutes: 5 });
const errorDefaults = {
  errorView: (_err: Error) => "",
  errorValidity: Temporal.Duration.from({ seconds: 30 }),
};

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
    ...errorDefaults,
  });

  const out = await conductor.trigger({
    t: at("2026-05-16T10:00"),
    intent: "poll",
    device: null,
  });

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
    ...errorDefaults,
  });

  const t0 = at("2026-05-16T10:00");
  const first = await conductor.trigger({ t: t0, intent: "poll", device: null });
  const second = await conductor.trigger({
    t: t0.add({ minutes: 1 }),
    intent: "poll",
    device: null,
  });
  const third = await conductor.trigger({
    t: t0.add({ minutes: 4 }),
    intent: "poll",
    device: null,
  });

  assertSpyCalls(run, 1);
  assertSpyCalls(deriveHtml, 1);
  assertSpyCalls(rasterize, 1);
  assertEquals(second.png, first.png);
  assertEquals(third.png, first.png);
  assertEquals(second.identity, first.identity);
});

Deno.test("when plugin.run throws, trigger falls back to the error view with its configured validity", async () => {
  const errorPng = new Uint8Array([0xee]);
  const boom = new Error("boom");

  const run = spy(() => {
    throw boom;
  });
  const errorView = spy((_err: Error) => "<p>error</p>");
  const deriveHtml = spy((r: Result<unknown>) => String(r.view(r.state)));
  const rasterize = spy(() => Promise.resolve(errorPng));

  const conductor = createConductor({
    plugin: { run },
    renderer: { deriveHtml, rasterize },
    identityFor: (html) => `id-${html}`,
    errorView,
    errorValidity: Temporal.Duration.from({ seconds: 30 }),
  });

  const t0 = at("2026-05-16T10:00");
  const out = await conductor.trigger({ t: t0, intent: "poll", device: null });

  assertSpyCalls(errorView, 1);
  assertEquals(errorView.calls[0].args[0], boom);
  assertEquals(out.png, errorPng);
  assertEquals(out.identity, "id-<p>error</p>");

  // Within the error validity, the next trigger reuses the error image.
  const second = await conductor.trigger({
    t: t0.add({ seconds: 20 }),
    intent: "poll",
    device: null,
  });
  assertSpyCalls(run, 1);
  assertSpyCalls(errorView, 1);
  assertSpyCalls(rasterize, 1);
  assertEquals(second.png, errorPng);
});

Deno.test("trigger after expiry rasterizes and replaces Current Image when identity differs", async () => {
  const pngs = [new Uint8Array([1]), new Uint8Array([2])];

  const run = spy(() => ({
    state: {},
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));
  const htmls = ["a", "b"];
  let derive = 0;
  const deriveHtml = spy(() => htmls[derive++]);
  let raster = 0;
  const rasterize = spy(() => Promise.resolve(pngs[raster++]));

  const conductor = createConductor({
    plugin: { run },
    renderer: { deriveHtml, rasterize },
    identityFor: (html) => `id-${html}`,
    ...errorDefaults,
  });

  const t0 = at("2026-05-16T10:00");
  const first = await conductor.trigger({ t: t0, intent: "poll", device: null });
  const second = await conductor.trigger({
    t: t0.add({ minutes: 6 }),
    intent: "poll",
    device: null,
  });

  assertSpyCalls(run, 2);
  assertSpyCalls(deriveHtml, 2);
  assertSpyCalls(rasterize, 2);
  assertEquals(first.png, pngs[0]);
  assertEquals(second.png, pngs[1]);
  assertEquals(first.identity, "id-a");
  assertEquals(second.identity, "id-b");
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
    ...errorDefaults,
  });

  const t0 = at("2026-05-16T10:00");
  const first = await conductor.trigger({ t: t0, intent: "poll", device: null });
  const second = await conductor.trigger({
    t: t0.add({ minutes: 6 }),
    intent: "poll",
    device: null,
  });

  assertSpyCalls(run, 2);
  assertSpyCalls(deriveHtml, 2);
  assertSpyCalls(rasterize, 1);
  assertEquals(second.png, first.png);
  assertEquals(second.identity, first.identity);
});

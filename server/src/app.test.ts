import { assert, assertEquals } from "@std/assert";
import type { SystemConfig } from "@hztrmnl/config/system";
import { createApp } from "./app.ts";
import type { Plugin } from "./plugin/plugin.ts";

// End-to-end through the real composition root: real PluginManager, real
// Renderer (loopback origin and all), real Slot, real Conductor, real
// dashboard. Only the two process boundaries are stubbed — the clock, and
// the browser that would rasterize (whose stand-in fetches the loopback URL
// the Renderer mounts, so the Plugin's HTML really does travel the wire).

const T0 = Temporal.ZonedDateTime.from("2026-07-05T12:00[Europe/Berlin]");
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const plugin: Plugin<{ label: string }> = {
  run: () => ({
    state: { label: "hello from the composition root" },
    validity: Temporal.Duration.from({ minutes: 5 }),
    view: (s) => `<p>${s.label}</p>`,
  }),
};

function testConfig(overrides: Partial<SystemConfig> = {}): SystemConfig {
  return {
    port: 0,
    publicUrlOrigin: "",
    friendlyId: "TEST",
    // Never dialled: fetchPngFromUrl is stubbed below.
    cdpUrl: "http://127.0.0.1:9222",
    // Keeps the Renderer's loopback bound to 127.0.0.1 during tests.
    loopbackHost: "127.0.0.1",
    plugin,
    pluginAssetsDir: "./does-not-exist",
    deviceId: "trmnl-x",
    timeZone: "Europe/Berlin",
    debug: false,
    ...overrides,
  };
}

Deno.test("boots the whole graph and serves a Plugin's Result at /api/display", async () => {
  const renderedUrls: string[] = [];
  let servedHtml = "";
  const app = await createApp(testConfig(), {
    now: () => T0,
    fetchPngFromUrl: async (url) => {
      renderedUrls.push(url);
      servedHtml = await (await fetch(url)).text();
      return PNG_MAGIC;
    },
  });

  try {
    const res = await app.app.request("/api/display", {
      headers: { "ID": "AA:BB:CC:DD:EE:FF", "Host": "byos.local" },
    });
    assertEquals(res.status, 200);
    const body = await res.json();

    const identity = String(body.image_url).replace(/^.*\/image\/|\.png$/g, "");
    assertEquals(body.image_url, `http://byos.local/image/${identity}.png`);
    assertEquals(body.filename, `image-${identity}`);
    assertEquals(body.refresh_rate, 300);

    // The stubbed browser was pointed at the Renderer's loopback origin.
    assertEquals(renderedUrls.length, 1);
    assert(renderedUrls[0].endsWith("/index.html"), renderedUrls[0]);

    // The Slot holds the in-flight rasterize, so /api/display answered before
    // the image existed; awaiting the PNG is what settles it.
    const png = await app.app.request(`/image/${identity}.png`);
    assertEquals(png.status, 200);
    assertEquals(png.headers.get("content-type"), "image/png");
    assertEquals(new Uint8Array(await png.arrayBuffer()), PNG_MAGIC);

    // And what the browser found on the loopback was this Plugin's view.
    assert(servedHtml.includes("hello from the composition root"), servedHtml);

    // Second poll is a cache hit: the Plugin ran once, the browser once.
    const again = await app.app.request("/api/display", {
      headers: { "ID": "AA:BB:CC:DD:EE:FF", "Host": "byos.local" },
    });
    assertEquals((await again.json()).image_url, body.image_url);
    assertEquals(renderedUrls.length, 1);

    const dash = await app.app.request("/");
    assertEquals(dash.status, 200);
  } finally {
    await app.shutdown();
  }
});

Deno.test("debug: true swaps in the debug panel and never starts the pipeline", async () => {
  const app = await createApp(testConfig({ debug: true }), {
    now: () => T0,
    fetchPngFromUrl: () => {
      throw new Error("the pipeline must not run in debug mode");
    },
  });

  try {
    const res = await app.app.request("/api/display", { headers: { "Host": "byos.local" } });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.image_url, "http://byos.local/image/debug-wedge.png");
    assertEquals(body.filename, "debug-wedge");
  } finally {
    await app.shutdown();
  }
});

Deno.test("an unknown deviceId fails at createApp, not at import", async () => {
  const err = await createApp(testConfig({ deviceId: "nope" })).catch((e: Error) => e);
  assert(err instanceof Error);
  assert(err.message.includes(`unknown deviceId "nope"`), err.message);
});

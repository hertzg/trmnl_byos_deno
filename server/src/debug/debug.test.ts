import { assert, assertEquals } from "@std/assert";
import { createDebugApp } from "./debug.ts";
import { createDeviceState } from "../device-state.ts";
import type { DeviceProfile } from "../render/profiles.ts";
import type { BuildInfo } from "../build-info.ts";

const fixedNow = () => Temporal.ZonedDateTime.from("2026-07-05T12:00[Europe/Berlin]");

// Small profile so pattern generation in tests is instant.
const profile: DeviceProfile = {
  width: 32,
  height: 16,
  bitDepth: 4,
  dither: "floyd-steinberg",
};

function makeApp(overrides: { fetch?: typeof fetch; build?: BuildInfo } = {}) {
  const deviceState = createDeviceState({ now: fixedNow });
  const app = createDebugApp({
    profile,
    deviceState,
    friendlyId: "TRMNL",
    publicUrlOrigin: "",
    now: fixedNow,
    ...overrides,
  });
  return { app, deviceState };
}

Deno.test("/api/display serves the default config until edited", async () => {
  const { app } = makeApp();
  const res = await app.request("/api/display");
  assertEquals(res.status, 200);
  const json = await res.json();
  assert(String(json.image_url).endsWith("/image/debug-wedge.png"));
  assertEquals(json.filename, "debug-wedge");
  assertEquals(json.refresh_rate, 60);
  assertEquals(json.status, 0);
  assertEquals(json.temperature_profile, "a");
  assertEquals(json.special_function, "none");
  assertEquals(json.reset_firmware, false);
  assertEquals(json.update_firmware, false);
});

Deno.test("POST /debug/config reshapes the /api/display response", async () => {
  const { app } = makeApp();
  const post = await app.request("/debug/config", {
    method: "POST",
    body: new URLSearchParams({
      pattern: "ramp",
      refreshRate: "300",
      status: "0",
      temperatureProfile: "b",
      specialFunction: "none",
      resetFirmware: "on",
      firmwareUrl: "",
    }),
  });
  assertEquals(post.status, 303);

  const json = await (await app.request("/api/display")).json();
  assert(String(json.image_url).endsWith("/image/debug-ramp.png"));
  assertEquals(json.filename, "debug-ramp");
  assertEquals(json.refresh_rate, 300);
  assertEquals(json.temperature_profile, "b");
  assertEquals(json.reset_firmware, true);
  // Checkboxes: absent from the form body means unchecked, not "keep".
  assertEquals(json.update_firmware, false);
});

Deno.test("POST /debug/config ignores an unknown pattern and clamps refresh", async () => {
  const { app } = makeApp();
  await app.request("/debug/config", {
    method: "POST",
    body: new URLSearchParams({ pattern: "nope", refreshRate: "0" }),
  });
  const json = await (await app.request("/api/display")).json();
  assert(String(json.image_url).endsWith("/image/debug-wedge.png"));
  assertEquals(json.refresh_rate, 1);
});

Deno.test("POST /debug/response replaces /api/display with exact editable JSON", async () => {
  const { app } = makeApp();
  const exact = {
    status: 202,
    image_url: "https://example.test/custom.png",
    filename: "manual",
    refresh_rate: 5,
    extra: { nested: true },
  };
  const post = await app.request("/debug/response", {
    method: "POST",
    body: new URLSearchParams({ responseJson: JSON.stringify(exact) }),
  });
  assertEquals(post.status, 303);
  assertEquals(await (await app.request("/api/display")).json(), exact);
});

Deno.test("POST /debug/config clears the exact JSON override", async () => {
  const { app } = makeApp();
  await app.request("/debug/response", {
    method: "POST",
    body: new URLSearchParams({
      responseJson: JSON.stringify({ status: 418, refresh_rate: 1 }),
    }),
  });
  await app.request("/debug/config", {
    method: "POST",
    body: new URLSearchParams({ pattern: "ramp", refreshRate: "90" }),
  });

  const json = await (await app.request("/api/display")).json();
  assert(String(json.image_url).endsWith("/image/debug-ramp.png"));
  assertEquals(json.filename, "debug-ramp");
  assertEquals(json.refresh_rate, 90);
});

Deno.test("POST /debug/config stores a custom upload in memory and selects it", async () => {
  const { app } = makeApp();
  const uploaded = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const form = new FormData();
  form.set("refreshRate", "45");
  form.set("customImage", new File([uploaded], "panel.png", { type: "image/png" }));

  const post = await app.request("/debug/config", { method: "POST", body: form });
  assertEquals(post.status, 303);

  const json = await (await app.request("/api/display")).json();
  assert(String(json.image_url).endsWith("/image/debug-custom-1.png"));
  assertEquals(json.filename, "debug-custom-1");
  assertEquals(json.refresh_rate, 45);

  const img = await app.request("/image/debug-custom-1.png");
  assertEquals(img.status, 200);
  assertEquals(img.headers.get("content-type"), "image/png");
  assertEquals(new Uint8Array(await img.arrayBuffer()), uploaded);
});

Deno.test("proxy mode forwards device-facing requests to the configured URL prefix", async () => {
  const seen: Array<{ url: string; method: string; body: string }> = [];
  const fetchStub: typeof fetch = (input, init) => {
    const body = init?.body instanceof ArrayBuffer ? new TextDecoder().decode(init.body) : "";
    seen.push({
      url: String(input),
      method: init?.method ?? "GET",
      body,
    });
    return Promise.resolve(
      new Response(JSON.stringify({ proxied: true }), {
        status: 207,
        headers: { "content-type": "application/json", "x-upstream": "yes" },
      }),
    );
  };
  const { app, deviceState } = makeApp({ fetch: fetchStub });

  const post = await app.request("/debug/proxy", {
    method: "POST",
    body: new URLSearchParams({
      proxyEnabled: "on",
      proxyTarget: "http://127.0.0.1:2300/local-prefix",
    }),
  });
  assertEquals(post.status, 303);

  const display = await app.request("/api/display?slot=1", {
    headers: { ID: "AA:BB:CC", RSSI: "-55" },
  });
  assertEquals(display.status, 207);
  assertEquals(display.headers.get("x-upstream"), "yes");
  assertEquals(await display.json(), { proxied: true });
  assertEquals(seen[0], {
    url: "http://127.0.0.1:2300/local-prefix/api/display?slot=1",
    method: "GET",
    body: "",
  });
  assertEquals(deviceState.latestDevice()?.id, "AA:BB:CC");

  const log = await app.request("/api/log", {
    method: "POST",
    headers: { ID: "AA:BB:CC" },
    body: "hello through proxy",
  });
  assertEquals(log.status, 207);
  assertEquals(seen[1], {
    url: "http://127.0.0.1:2300/local-prefix/api/log",
    method: "POST",
    body: "hello through proxy",
  });
  assertEquals(deviceState.recentLogs()[0].body, "hello through proxy");
});

Deno.test("/image serves debug patterns and 404s everything else", async () => {
  const { app } = makeApp();
  const ok = await app.request("/image/debug-checker.png");
  assertEquals(ok.status, 200);
  assertEquals(ok.headers.get("content-type"), "image/png");
  const png = new Uint8Array(await ok.arrayBuffer());
  assertEquals([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

  assertEquals((await app.request("/image/debug-nope.png")).status, 404);
  // No debug- prefix → not a pattern URL, even if the name matches one.
  assertEquals((await app.request("/image/checker.png")).status, 404);
});

Deno.test("/api/display records what the device sent", async () => {
  const { app, deviceState } = makeApp();
  await app.request("/api/display", {
    headers: { ID: "AA:BB:CC", "Battery-Voltage": "4.0", RSSI: "-55" },
  });
  const report = deviceState.latestDevice();
  assert(report !== null);
  assertEquals(report.id, "AA:BB:CC");
  assertEquals(report.rssi, -55);
  const headers = deviceState.latestPollHeaders();
  assert(headers !== null && headers.some(([name]) => name === "id"));
});

Deno.test("/api/log lands in the device state ring", async () => {
  const { app, deviceState } = makeApp();
  const res = await app.request("/api/log", {
    method: "POST",
    headers: { ID: "AA:BB:CC" },
    body: "hello from firmware",
  });
  assertEquals(res.status, 204);
  assertEquals(deviceState.recentLogs().length, 1);
  assertEquals(deviceState.recentLogs()[0].body, "hello from firmware");
});

Deno.test("the control panel page renders", async () => {
  const { app } = makeApp();
  const res = await app.request("/");
  assertEquals(res.status, 200);
  const html = await res.text();
  assert(html.includes("debug mode"));
  assert(html.includes("/image/debug-wedge.png"));
  assert(html.includes('name="responseJson"'));
  assert(html.includes('name="customImage"'));
  assert(html.includes('name="proxyTarget"'));
  assert(html.includes("debug: false"));
});

Deno.test("the panel topbar shows the build identity like the dashboard's", async () => {
  const { app } = makeApp({
    build: {
      version: "0.1.0+20260705100000Z",
      builtAt: Temporal.Instant.from("2026-07-05T10:00:00Z"),
    },
  });
  const html = await (await app.request("/")).text();
  assert(html.includes("0.1.0+20260705100000Z"), "version missing from the panel");
  // Rendered in the page tz — Europe/Berlin is UTC+2 in July.
  assert(html.includes("released 2026-07-05 12:00:00"), "release time missing");
});

Deno.test("the panel without build info shows a dateless <base>+dev build", async () => {
  const { app } = makeApp();
  const html = await (await app.request("/")).text();
  assert(/class="build"><code>[^<]+\+dev<\/code>/.test(html), "dev fallback missing");
  assert(!html.includes("released"), "a dev build has no release time");
});

Deno.test("the panel offers a paste-latest-official firmware button once the Device's model is known", async () => {
  // The button carries the resolved S3 URL for the reported model family;
  // 1.8.10 must beat 1.8.9 (lexicographic order would invert them) and the
  // dev/ CI build must not count as a release.
  const listing = `<ListBucketResult>
    <Contents><Key>trmnl_x/FW1.8.9.bin</Key></Contents>
    <Contents><Key>trmnl_x/FW1.8.10.bin</Key></Contents>
    <Contents><Key>trmnl_x/dev/FW1.9.0-trmnl_x-ota-abc1234.bin</Key></Contents>
  </ListBucketResult>`;
  const fetched: string[] = [];
  const { app } = makeApp({
    fetch: ((url: string | URL | Request) => {
      fetched.push(String(url));
      return Promise.resolve(new Response(listing));
    }) as typeof fetch,
  });

  // A poll reveals the model; the next panel render can resolve the family.
  await (await app.request("/api/display", { headers: { ID: "AA:BB:CC", Model: "x" } })).body
    ?.cancel();
  const html = await (await app.request("/")).text();

  assertEquals(fetched, [
    "https://trmnl-fw.s3.us-east-2.amazonaws.com/?list-type=2&prefix=trmnl_x/",
  ]);
  assert(
    html.includes(
      'data-firmware-url="https://trmnl-fw.s3.us-east-2.amazonaws.com/trmnl_x/FW1.8.10.bin"',
    ),
  );
  assert(html.includes("paste latest official (1.8.10)"));
});

Deno.test("the panel renders without the firmware button when the model is unknown or the bucket is unreachable", async () => {
  // Unknown model: no poll yet — the bucket is never contacted.
  const neverFetch = (() => {
    throw new Error("must not fetch");
  }) as typeof fetch;
  const cold = makeApp({ fetch: neverFetch });
  const coldHtml = await (await cold.app.request("/")).text();
  assert(!coldHtml.includes('data-firmware-url="'));

  // Known model but the bucket fetch fails: the panel still renders.
  const offline = makeApp({
    fetch: (() => Promise.reject(new Error("offline"))) as typeof fetch,
  });
  await (await offline.app.request("/api/display", { headers: { ID: "AA:BB:CC", Model: "x" } }))
    .body?.cancel();
  const offlineRes = await offline.app.request("/");
  assertEquals(offlineRes.status, 200);
  assert(!(await offlineRes.text()).includes('data-firmware-url="'));
});

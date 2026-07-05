import { assert, assertEquals } from "@std/assert";
import { createDebugApp } from "./debug.ts";
import { createDeviceState } from "../device-state.ts";
import type { DeviceProfile } from "../render/profiles.ts";

const fixedNow = () => Temporal.ZonedDateTime.from("2026-07-05T12:00[Europe/Berlin]");

// Small profile so pattern generation in tests is instant.
const profile: DeviceProfile = {
  width: 32,
  height: 16,
  bitDepth: 4,
  dither: "floyd-steinberg",
};

function makeApp() {
  const deviceState = createDeviceState({ now: fixedNow });
  const app = createDebugApp({
    profile,
    deviceState,
    friendlyId: "TRMNL",
    now: fixedNow,
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
  assert(html.includes("debug: false"));
});

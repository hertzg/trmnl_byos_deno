import { assertEquals } from "@std/assert";
import { identity } from "./device.ts";
import type { Telemetry } from "./device.ts";
import { displayHeaders, imageHeaders, logHeaders, setupHeaders } from "./headers.ts";

const OPTIONS = {
  base: "http://localhost:3000",
  id: "AA:BB:CC:DD:EE:FF",
  token: "token-abc123",
  fw: "9.9.9",
} as const;

const STATE: Telemetry = {
  wake: "button",
  refreshRate: 120,
  battery: 3.7,
  rssi: -71,
  cached: true,
};

// The six headers buildDisplayHeaders guards behind `#ifdef BOARD_TRMNL_X`.
const GAUGE_HEADERS = [
  "battery-count",
  "percent-charged",
  "battery-health",
  "battery-current",
  "battery-temp",
  "battery-capacity",
];

Deno.test("setup sends only the four headers buildSetupHeaders builds", () => {
  const headers = setupHeaders(identity({ ...OPTIONS, board: "x" }));
  assertEquals([...headers.keys()].sort(), ["content-type", "fw-version", "id", "model"]);
});

Deno.test("setup carries no Access-Token — the firmware has none yet", () => {
  const headers = setupHeaders(identity({ ...OPTIONS, board: "x" }));
  assertEquals(headers.get("Access-Token"), null);
});

Deno.test("display reports the telemetry it was given", () => {
  const headers = displayHeaders(identity({ ...OPTIONS, board: "x" }), STATE);
  assertEquals(headers.get("Update-Source"), "button");
  assertEquals(headers.get("Refresh-Rate"), "120");
  assertEquals(headers.get("Battery-Voltage"), "3.7");
  assertEquals(headers.get("RSSI"), "-71");
  assertEquals(headers.get("Image-Cached"), "true");
});

Deno.test("display on an X board sends the fuel-gauge headers", () => {
  const headers = displayHeaders(identity({ ...OPTIONS, board: "x" }), STATE);
  const present = GAUGE_HEADERS.filter((name) => headers.has(name));
  assertEquals(present, GAUGE_HEADERS);
});

Deno.test("display on an OG board sends none of the fuel-gauge headers", () => {
  const headers = displayHeaders(identity({ ...OPTIONS, board: "og" }), STATE);
  const present = GAUGE_HEADERS.filter((name) => headers.has(name));
  assertEquals(present, []);
});

Deno.test("display reports the board's model and panel size", () => {
  const headers = displayHeaders(identity({ ...OPTIONS, board: "og" }), STATE);
  assertEquals(headers.get("Model"), "og");
  assertEquals(headers.get("Width"), "800");
  assertEquals(headers.get("Height"), "480");
});

Deno.test("image on the api's own host carries the device's credentials", () => {
  const device = identity({ ...OPTIONS, board: "x" });
  const headers = imageHeaders(device, "http://localhost:3000/image/wedge.png");
  assertEquals(headers.get("ID"), "AA:BB:CC:DD:EE:FF");
  assertEquals(headers.get("Access-Token"), "token-abc123");
});

Deno.test("image on a foreign host carries no credentials", () => {
  const device = identity({ ...OPTIONS, board: "x" });
  const headers = imageHeaders(device, "https://example.com/image/wedge.png");
  assertEquals(headers.get("ID"), null);
  assertEquals(headers.get("Access-Token"), null);
});

Deno.test("image always disables compression, whoever hosts it", () => {
  const device = identity({ ...OPTIONS, board: "x" });
  assertEquals(
    imageHeaders(device, "https://example.com/wedge.png").get("Accept-Encoding"),
    "identity",
  );
});

Deno.test("log sends the four headers buildLogHeaders builds", () => {
  const headers = logHeaders(identity({ ...OPTIONS, board: "x" }));
  assertEquals([...headers.keys()].sort(), ["accept", "access-token", "content-type", "id"]);
});

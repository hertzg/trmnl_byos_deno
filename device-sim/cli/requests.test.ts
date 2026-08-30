import { assertEquals, assertInstanceOf, assertStringIncludes } from "@std/assert";
import { stub } from "@std/testing/mock";
import { identity } from "../firmware/device.ts";
import type { Telemetry } from "../firmware/device.ts";
import { RequestFailed } from "./http.ts";
import { getDisplay, getImage, getSetup, postLog } from "./requests.ts";

const DEVICE = identity({
  base: "http://localhost:3000",
  id: "AA:BB:CC:DD:EE:FF",
  token: "token-abc123",
  fw: "9.9.9",
  board: "x",
});

const STATE: Telemetry = {
  wake: "timer",
  refreshRate: 900,
  battery: 3.9,
  rssi: -55,
  cached: false,
};

// Answers each url with a canned response and records what was sent, so a test
// can assert on both halves of the exchange without a server.
function stubFetch(routes: Record<string, Response>) {
  const sent: { url: string; init?: RequestInit }[] = [];
  const fetchStub = stub(
    globalThis,
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      sent.push({ url, init });
      const response = routes[url];
      if (response === undefined) return Promise.reject(new Error(`unrouted fetch: ${url}`));
      return Promise.resolve(response);
    },
  );
  return { sent, [Symbol.dispose]: () => fetchStub.restore() };
}

// The subcommands print as they go; tests capture that instead of spraying it
// across the test output.
function captureLines() {
  const lines: string[] = [];
  const logStub = stub(console, "log", (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  return { lines, [Symbol.dispose]: () => logStub.restore() };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: "OK",
    headers: { "content-type": "application/json" },
  });
}

function png(bytes: Uint8Array<ArrayBuffer>): Response {
  return new Response(bytes, {
    status: 200,
    statusText: "OK",
    headers: { "content-type": "image/png" },
  });
}

Deno.test("getSetup prints the server's response body", async () => {
  using _fetch = stubFetch({
    "http://localhost:3000/api/setup": json({ status: 200, friendly_id: "TRMNL" }),
  });
  using capture = captureLines();

  await getSetup(DEVICE, false);
  assertEquals(capture.lines, ['{"status":200,"friendly_id":"TRMNL"}']);
});

Deno.test("getSetup dumps the whole exchange under debug", async () => {
  using _fetch = stubFetch({ "http://localhost:3000/api/setup": json({ status: 200 }) });
  using capture = captureLines();

  await getSetup(DEVICE, true);
  assertEquals(capture.lines[0], "> GET http://localhost:3000/api/setup");
  assertStringIncludes(capture.lines.join("\n"), ">   model: x");
});

Deno.test("getDisplay hands back the parsed response", async () => {
  using _fetch = stubFetch({
    "http://localhost:3000/api/display": json({ refresh_rate: 60, filename: "wedge" }),
  });
  using _log = captureLines();

  const display = await getDisplay(DEVICE, STATE, false);
  assertEquals(display.refresh_rate, 60);
  assertEquals(display.filename, "wedge");
});

Deno.test("getDisplay yields an empty object when the body is not json", async () => {
  using _fetch = stubFetch({
    "http://localhost:3000/api/display": new Response("gateway timeout", {
      status: 504,
      statusText: "Gateway Timeout",
      headers: { "content-type": "text/plain" },
    }),
  });
  using _log = captureLines();

  assertEquals(await getDisplay(DEVICE, STATE, false), {});
});

Deno.test("getImage asks /api/display for the url when none is given", async () => {
  using fetched = stubFetch({
    "http://localhost:3000/api/display": json({ image_url: "http://localhost:3000/image/w.png" }),
    "http://localhost:3000/image/w.png": png(new Uint8Array([137, 80, 78, 71])),
  });
  using _log = captureLines();
  const out = await Deno.makeTempFile({ suffix: ".png" });

  try {
    await getImage(DEVICE, undefined, { preview: false, out, debug: false });
    assertEquals(fetched.sent.map((call) => call.url), [
      "http://localhost:3000/api/display",
      "http://localhost:3000/image/w.png",
    ]);
    assertEquals(await Deno.readFile(out), new Uint8Array([137, 80, 78, 71]));
  } finally {
    await Deno.remove(out);
  }
});

Deno.test("getImage sends no credentials to a third-party image host", async () => {
  using fetched = stubFetch({
    "https://example.com/w.png": png(new Uint8Array([1])),
  });
  using _log = captureLines();
  const out = await Deno.makeTempFile({ suffix: ".png" });

  try {
    await getImage(DEVICE, "https://example.com/w.png", { preview: false, out, debug: false });
    const headers = new Headers(fetched.sent[0].init?.headers);
    assertEquals(headers.get("Access-Token"), null);
  } finally {
    await Deno.remove(out);
  }
});

Deno.test("getImage refuses to save a response that is not an image", async () => {
  using _fetch = stubFetch({
    "http://localhost:3000/image/gone.png": new Response("Not Found", {
      status: 404,
      statusText: "Not Found",
      headers: { "content-type": "text/plain" },
    }),
  });
  using _log = captureLines();

  const error = await getImage(DEVICE, "http://localhost:3000/image/gone.png", {
    preview: false,
    debug: false,
  }).catch((e) => e);
  assertInstanceOf(error, RequestFailed);
  assertStringIncludes(error.message, "returned 404, not an image");
});

Deno.test("getImage reports the byte count and the path it wrote", async () => {
  using _fetch = stubFetch({
    "http://localhost:3000/image/w.png": png(new Uint8Array([1, 2, 3])),
  });
  using capture = captureLines();
  const out = await Deno.makeTempFile({ suffix: ".png" });

  try {
    await getImage(DEVICE, "http://localhost:3000/image/w.png", {
      preview: false,
      out,
      debug: false,
    });
    assertEquals(capture.lines, ["3 bytes", out]);
  } finally {
    await Deno.remove(out);
  }
});

Deno.test("postLog sends the log envelope as the request body", async () => {
  using fetched = stubFetch({
    "http://localhost:3000/api/log": new Response(null, { status: 204, statusText: "No Content" }),
  });
  using _log = captureLines();

  await postLog(DEVICE, STATE, "disk full", "error", false);
  const body = JSON.parse(String(fetched.sent[0].init?.body)) as {
    logs: Record<string, unknown>[];
  };
  assertEquals(body.logs[0].message, "disk full");
  assertEquals(body.logs[0].level, "error");
});

Deno.test("postLog prints the status, since /api/log answers 204 with no body", async () => {
  using _fetch = stubFetch({
    "http://localhost:3000/api/log": new Response(null, { status: 204, statusText: "No Content" }),
  });
  using capture = captureLines();

  await postLog(DEVICE, STATE, "hello", "info", false);
  assertEquals(capture.lines, ["204 No Content"]);
});

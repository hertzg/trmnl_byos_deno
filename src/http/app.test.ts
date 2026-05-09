import {
  assertEquals,
  assertGreaterOrEqual,
  assertLessOrEqual,
  assertStringIncludes,
} from "@std/assert";
import { createApp } from "./app.ts";
import type { Renderer } from "../render/renderer.ts";

function fakeRenderer(overrides: Partial<Renderer> = {}): Renderer {
  return {
    ensureFrame: () => Promise.reject(new Error("ensureFrame not configured")),
    getJobHtml: () => undefined,
    getJobPng: () => undefined,
    renderEphemeral: () => Promise.reject(new Error("renderEphemeral not configured")),
    previewHtml: () => Promise.reject(new Error("previewHtml not configured")),
    previewPng: () => Promise.reject(new Error("previewPng not configured")),
    ...overrides,
  };
}

Deno.test("GET /preview/:jobId returns 404 for unknown jobId", async () => {
  const app = createApp({
    renderer: fakeRenderer({ getJobHtml: () => undefined }),
    friendlyId: "test",
  });

  const res = await app.fetch(new Request("http://x/preview/missing"));
  await res.body?.cancel();

  assertEquals(res.status, 404);
});

Deno.test("GET /preview/:jobId/png returns stored PNG bytes for an active job", async () => {
  const app = createApp({
    renderer: fakeRenderer({
      getJobPng: (id) => (id === "abc" ? new Uint8Array([0x89, 0x50, 0x4e, 0x47]) : undefined),
    }),
    friendlyId: "test",
  });

  const res = await app.fetch(new Request("http://x/preview/abc/png"));

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "image/png");
  assertEquals(new Uint8Array(await res.arrayBuffer()), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
});

Deno.test("GET /preview/:jobId/png returns 404 for unknown jobId", async () => {
  const app = createApp({
    renderer: fakeRenderer({ getJobPng: () => undefined }),
    friendlyId: "test",
  });

  const res = await app.fetch(new Request("http://x/preview/missing/png"));
  await res.body?.cancel();

  assertEquals(res.status, 404);
});

Deno.test("GET /api/display returns BYOS JSON with image_url at /preview/:jobId/png and a derived refresh_rate", async () => {
  const validUntil = new Date(Date.now() + 60_000);
  const app = createApp({
    renderer: fakeRenderer({
      ensureFrame: () => Promise.resolve({ jobId: "abc", validUntil }),
    }),
    friendlyId: "test",
  });

  const res = await app.fetch(new Request("http://x.example/api/display"));

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, 0);
  assertEquals(body.image_url, "http://x.example/preview/abc/png");
  assertEquals(body.filename, "image-abc");
  assertGreaterOrEqual(body.refresh_rate, 58);
  assertLessOrEqual(body.refresh_rate, 60);
});

Deno.test("GET /api/display returns 500 when ensureFrame throws", async () => {
  const app = createApp({
    renderer: fakeRenderer({
      ensureFrame: () => Promise.reject(new Error("rasterize-down")),
    }),
    friendlyId: "test",
  });

  const res = await app.fetch(new Request("http://x.example/api/display"));
  await res.body?.cancel();

  assertEquals(res.status, 500);
});

Deno.test("GET /api/setup returns BYOS setup response with friendlyId", async () => {
  const app = createApp({
    renderer: fakeRenderer(),
    friendlyId: "MY-DEVICE",
  });

  const res = await app.fetch(new Request("http://x.example/api/setup"));

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, 200);
  assertEquals(body.api_key, "byos");
  assertEquals(body.friendly_id, "MY-DEVICE");
});

Deno.test("POST /api/log accepts a log body, calls onDeviceLog, returns 204", async () => {
  const logged: Array<{ id: string; body: string }> = [];
  const app = createApp({
    renderer: fakeRenderer(),
    friendlyId: "test",
    onDeviceLog: (id, body) => logged.push({ id, body }),
  });

  const res = await app.fetch(
    new Request("http://x.example/api/log", {
      method: "POST",
      headers: { "id": "AA:BB", "content-type": "text/plain" },
      body: "device says hi",
    }),
  );

  assertEquals(res.status, 204);
  assertEquals(logged, [{ id: "AA:BB", body: "device says hi" }]);
});

Deno.test("GET /preview returns text/html with the live preview HTML and cache-control: no-store", async () => {
  const app = createApp({
    renderer: fakeRenderer({
      previewHtml: () => Promise.resolve("<h1>preview body</h1>"),
    }),
    friendlyId: "test",
  });

  const res = await app.fetch(new Request("http://x.example/preview"));

  assertEquals(res.status, 200);
  assertEquals((res.headers.get("content-type") ?? "").startsWith("text/html"), true);
  assertEquals(res.headers.get("cache-control"), "no-store");
  assertEquals(await res.text(), "<h1>preview body</h1>");
});

Deno.test("GET /preview returns 500 with stack-trace HTML when previewHtml throws", async () => {
  const app = createApp({
    renderer: fakeRenderer({
      previewHtml: () => Promise.reject(new Error("template-broken")),
    }),
    friendlyId: "test",
  });

  const res = await app.fetch(new Request("http://x.example/preview"));

  assertEquals(res.status, 500);
  assertEquals((res.headers.get("content-type") ?? "").startsWith("text/html"), true);
  const body = await res.text();
  assertStringIncludes(body, "template-broken");
});

Deno.test("GET /preview/png returns image/png with bytes from previewPng and cache-control: no-store", async () => {
  const app = createApp({
    renderer: fakeRenderer({
      previewPng: () => Promise.resolve(new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
    }),
    friendlyId: "test",
  });

  const res = await app.fetch(new Request("http://x.example/preview/png"));

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "image/png");
  assertEquals(res.headers.get("cache-control"), "no-store");
  assertEquals(new Uint8Array(await res.arrayBuffer()), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
});

Deno.test("GET /preview/png returns 500 when previewPng throws", async () => {
  const app = createApp({
    renderer: fakeRenderer({
      previewPng: () => Promise.reject(new Error("cdp-down")),
    }),
    friendlyId: "test",
  });

  const res = await app.fetch(new Request("http://x.example/preview/png"));
  await res.body?.cancel();

  assertEquals(res.status, 500);
});

Deno.test("GET /preview/:jobId returns stored HTML for an active job", async () => {
  const app = createApp({
    renderer: fakeRenderer({
      getJobHtml: (id) => (id === "abc" ? "<h1>hi</h1>" : undefined),
    }),
    friendlyId: "test",
  });

  const res = await app.fetch(new Request("http://x/preview/abc"));

  assertEquals(res.status, 200);
  assertEquals((res.headers.get("content-type") ?? "").startsWith("text/html"), true);
  assertEquals(await res.text(), "<h1>hi</h1>");
});

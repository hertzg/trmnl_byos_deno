import { assertEquals, assertRejects } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { type CdpRasterize, createCdpRasterize } from "./cdp-rasterize.ts";

// Simulates CDP: fetchPngFromUrl reaches back into the rasterizer's own
// preview route to check that the shelved HTML is actually fetchable
// through it. `ref` lets fetchPngFromUrl close over the bridge we'll
// only construct on the next line.
type Ref = { bridge?: CdpRasterize };

Deno.test("rasterize shelves html under a generated id, hands CDP /preview/:id on the configured origin, and returns the PNG", async () => {
  const expectedPng = new Uint8Array([42]);
  const ref: Ref = {};
  let urlFetched: string | undefined;
  let htmlSeenViaPreview: string | undefined;

  const fetchPngFromUrl = spy(async (url: string) => {
    urlFetched = url;
    const path = new URL(url).pathname;
    const res = await ref.bridge!.app.request(path);
    htmlSeenViaPreview = await res.text();
    return expectedPng;
  });

  ref.bridge = createCdpRasterize({ origin: "http://internal:8080", fetchPngFromUrl });

  const png = await ref.bridge.rasterize("<p>render me</p>");

  assertEquals(png, expectedPng);
  assertEquals(htmlSeenViaPreview, "<p>render me</p>");
  assertSpyCalls(fetchPngFromUrl, 1);
  assertEquals(urlFetched?.startsWith("http://internal:8080/__internal/render/"), true);
});

Deno.test("rasterize removes the shelf entry once the PNG is back so the id 404s afterwards", async () => {
  let urlFetched: string | undefined;
  const fetchPngFromUrl = spy((url: string) => {
    urlFetched = url;
    return Promise.resolve(new Uint8Array([1]));
  });

  const bridge = createCdpRasterize({ origin: "http://internal:8080", fetchPngFromUrl });

  await bridge.rasterize("<p>x</p>");

  const path = new URL(urlFetched!).pathname;
  const after = await bridge.app.request(path);
  await after.body?.cancel();

  assertEquals(after.status, 404);
});

Deno.test("rasterize cleans up the shelf even when fetchPngFromUrl throws", async () => {
  let urlFetched: string | undefined;
  const fetchPngFromUrl = spy((url: string) => {
    urlFetched = url;
    return Promise.reject(new Error("CDP exploded"));
  });

  const bridge = createCdpRasterize({ origin: "http://internal:8080", fetchPngFromUrl });

  await assertRejects(() => bridge.rasterize("<p>x</p>"), Error, "CDP exploded");

  const path = new URL(urlFetched!).pathname;
  const after = await bridge.app.request(path);
  await after.body?.cancel();

  assertEquals(after.status, 404);
});

Deno.test("preview route 404s for an unknown id", async () => {
  const bridge = createCdpRasterize({
    origin: "http://internal:8080",
    fetchPngFromUrl: () => Promise.resolve(new Uint8Array()),
  });

  const res = await bridge.app.request("/__internal/render/never-shelved");
  await res.body?.cancel();

  assertEquals(res.status, 404);
});

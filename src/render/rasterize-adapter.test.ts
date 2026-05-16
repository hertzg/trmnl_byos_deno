import { assertEquals, assertRejects } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { createHtmlShelf } from "./html-shelf.ts";
import { createRasterizeAdapter } from "./rasterize-adapter.ts";

Deno.test("adapter shelves html, calls fetchPngFromUrl with /preview/:id, returns the png, and cleans up the shelf", async () => {
  const shelf = createHtmlShelf();
  const expectedPng = new Uint8Array([42]);
  let urlFetched: string | undefined;
  let htmlSeenByCdp: string | undefined;

  const fetchPngFromUrl = spy((url: string) => {
    urlFetched = url;
    const id = url.split("/").pop()!;
    htmlSeenByCdp = shelf.fetch(id);
    return Promise.resolve(expectedPng);
  });

  const rasterize = createRasterizeAdapter({
    shelf,
    origin: "http://internal:8080",
    fetchPngFromUrl,
  });

  const png = await rasterize("<p>render me</p>");

  assertEquals(png, expectedPng);
  assertEquals(htmlSeenByCdp, "<p>render me</p>");
  assertSpyCalls(fetchPngFromUrl, 1);
  assertEquals(urlFetched?.startsWith("http://internal:8080/preview/"), true);

  const id = urlFetched!.split("/").pop()!;
  assertEquals(shelf.fetch(id), undefined);
});

Deno.test("adapter cleans up the shelf even when fetchPngFromUrl throws", async () => {
  const shelf = createHtmlShelf();
  let idShelvedDuringRasterize: string | undefined;

  const fetchPngFromUrl = spy((url: string) => {
    idShelvedDuringRasterize = url.split("/").pop();
    return Promise.reject(new Error("CDP exploded"));
  });

  const rasterize = createRasterizeAdapter({
    shelf,
    origin: "http://internal:8080",
    fetchPngFromUrl,
  });

  await assertRejects(() => rasterize("<p>x</p>"), Error, "CDP exploded");

  // The id used during this rasterize is no longer in the shelf.
  assertEquals(shelf.fetch(idShelvedDuringRasterize!), undefined);
});

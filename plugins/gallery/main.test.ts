import { assertEquals, assertExists } from "@std/assert";
import type { RunContext } from "@hztrmnl/server/plugin";
import GalleryPlugin from "./main.ts";

// `run` is exercised end-to-end through the real album.ts client, with only
// `fetch` mocked — "stubbing the client layer" here means intercepting the
// iCloud HTTP boundary, since ESM named exports can't be reassigned/stubbed
// (module namespace bindings are non-configurable).

function zdt(offset: Temporal.DurationLike): Temporal.ZonedDateTime {
  return Temporal.Instant.from("2026-01-01T00:00:00Z").add(offset).toZonedDateTimeISO("UTC");
}

function ctx(intent: RunContext["intent"]): RunContext {
  return { t: zdt({ hours: 0 }), intent, device: null };
}

type FakePhoto = {
  guid: string;
  dateCreated?: string;
  batchDateCreated?: string;
  checksum: string;
};

// Answers the iCloud webstream/webasseturls contract with `photos`, enough of
// the real shape for main.ts's control flow (album.test.ts covers the
// client's own parsing/sorting in depth).
function stubAlbum(photos: FakePhoto[]): Disposable {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL) => {
    const url = String(input);
    if (url.includes("/sharedstreams/webstream")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            photos: photos.map((p) => ({
              photoGuid: p.guid,
              dateCreated: p.dateCreated ?? "2026-01-01T00:00:00Z",
              batchDateCreated: p.batchDateCreated ?? "2026-01-01T00:00:00Z",
              derivatives: {
                "0": { checksum: p.checksum, fileSize: "1", width: "800", height: "600" },
              },
            })),
          }),
          { status: 200 },
        ),
      );
    }
    if (url.includes("/sharedstreams/webasseturls")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: Object.fromEntries(
              photos.map((
                p,
              ) => [p.checksum, {
                url_location: "cvws.icloud-content.com",
                url_path: `/${p.checksum}`,
              }]),
            ),
          }),
          { status: 200 },
        ),
      );
    }
    return Promise.resolve(new Response("unexpected path", { status: 404 }));
  }) as unknown as typeof fetch;
  return { [Symbol.dispose]: () => (globalThis.fetch = original) };
}

function stubAlbumFailure(): Disposable {
  const original = globalThis.fetch;
  globalThis.fetch =
    (() => Promise.resolve(new Response("boom", { status: 500 }))) as unknown as typeof fetch;
  return { [Symbol.dispose]: () => (globalThis.fetch = original) };
}

Deno.test("run: album fetch failure returns the error note and 15min validity", async () => {
  using _s = stubAlbumFailure();
  const result = await GalleryPlugin.run(ctx("poll"));
  assertEquals(result.state.src, null);
  assertEquals(result.state.note, "Album fetch failed: icloud webstream: HTTP 500");
  assertEquals(result.validity.total({ unit: "minutes" }), 15);
});

Deno.test("run: a successful poll returns a src and a Duration validity", async () => {
  using _s = stubAlbum([{ guid: "GOOD-GUID", checksum: "chk-good" }]);
  const result = await GalleryPlugin.run(ctx("poll"));
  assertExists(result.state.src);
  assertEquals(result.validity instanceof Temporal.Duration, true);
});

Deno.test("run: an empty album returns a note and 15min validity", async () => {
  using _s = stubAlbum([]);
  const result = await GalleryPlugin.run(ctx("poll"));
  assertEquals(result.state.src, null);
  assertEquals(result.state.note, "The shared album is empty");
  assertEquals(result.validity.total({ unit: "minutes" }), 15);
});

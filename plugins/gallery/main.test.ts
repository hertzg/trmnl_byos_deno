import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
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
  // iCloud re-signs on every webasseturls call — the URL for the SAME photo
  // differs per request (expiry/signature params). The counter reproduces
  // that churn; tests relying on a stable src would be asserting a fiction.
  let signCounter = 0;
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
      signCounter++;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: Object.fromEntries(
              photos.map((
                p,
              ) => [p.checksum, {
                url_location: "cvws.icloud-content.com",
                url_path: `/${p.checksum}?sig=${signCounter}`,
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

Deno.test("run: hints.identity stays constant for the same photo while the signed src churns", async () => {
  // The regression behind "the panel wipes every refill for the same photo":
  // the src is a per-run signed URL, so the Bundle hash can never be stable.
  // The asserted identity — keyed on the derivative checksum — is what keeps
  // the Device-facing filename constant between rotations.
  using _s = stubAlbum([{ guid: "GOOD-GUID", checksum: "chk-good" }]);
  const first = await GalleryPlugin.run(ctx("poll"));
  const second = await GalleryPlugin.run(ctx("poll"));

  assertNotEquals(first.state.src, second.state.src); // the URL really churned
  assertEquals(first.hints?.identity, "photo:chk-good");
  assertEquals(second.hints?.identity, first.hints?.identity);
});

Deno.test("run: a different photo yields a different hints.identity", async () => {
  let a, b;
  {
    using _s = stubAlbum([{ guid: "GUID-A", checksum: "chk-a" }]);
    a = await GalleryPlugin.run(ctx("poll"));
  }
  {
    using _s = stubAlbum([{ guid: "GUID-B", checksum: "chk-b" }]);
    b = await GalleryPlugin.run(ctx("poll"));
  }

  assertNotEquals(a.hints?.identity, b.hints?.identity);
});

Deno.test("run: an empty album returns a note and 15min validity", async () => {
  using _s = stubAlbum([]);
  const result = await GalleryPlugin.run(ctx("poll"));
  assertEquals(result.state.src, null);
  assertEquals(result.state.note, "The shared album is empty");
  assertEquals(result.validity.total({ unit: "minutes" }), 15);
});

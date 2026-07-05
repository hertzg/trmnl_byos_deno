import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { fetchAlbum, fetchAssetUrl, parseAlbumToken } from "./album.ts";
import type { AlbumPhoto } from "./album.ts";

// ---------------------------------------------------------------------------
// parseAlbumToken
// ---------------------------------------------------------------------------

Deno.test("parseAlbumToken: valid shared-album link → the fragment token", () => {
  assertEquals(
    parseAlbumToken("https://www.icloud.com/sharedalbum/#FAKE-TOKEN-123"),
    "FAKE-TOKEN-123",
  );
});

Deno.test("parseAlbumToken: garbage input throws a descriptive Error", () => {
  assertThrows(() => parseAlbumToken("not a url at all"), Error, "not a shared-album link");
});

Deno.test("parseAlbumToken: well-formed URL on the wrong host throws", () => {
  assertThrows(
    () => parseAlbumToken("https://example.com/sharedalbum/#FAKE-TOKEN"),
    Error,
    "not a shared-album link",
  );
});

Deno.test("parseAlbumToken: shared-album URL missing its fragment throws", () => {
  assertThrows(
    () => parseAlbumToken("https://www.icloud.com/sharedalbum/"),
    Error,
    "missing its token fragment",
  );
});

// ---------------------------------------------------------------------------
// fetchAlbum / fetchAssetUrl — fetch mocked, fake token only
// ---------------------------------------------------------------------------

const TOKEN = "fake-test-token";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function streamPhoto(
  guid: string,
  opts: {
    dateCreated?: string;
    batchDateCreated?: string;
    mediaAssetType?: string;
    derivatives?: Record<
      string,
      { checksum: string; fileSize: string; width: string; height: string }
    >;
  } = {},
) {
  return {
    photoGuid: guid,
    dateCreated: opts.dateCreated ?? "2026-01-01T00:00:00Z",
    batchDateCreated: opts.batchDateCreated ?? "2026-01-01T00:00:00Z",
    mediaAssetType: opts.mediaAssetType,
    derivatives: opts.derivatives ?? {
      "0": { checksum: `chk-${guid}`, fileSize: "1", width: "800", height: "600" },
    },
  };
}

Deno.test("fetchAlbum: filters videos, picks the largest derivative, sorts newest-first", async () => {
  const fetchStub = spy((_input: string | URL, _init?: RequestInit) => {
    return Promise.resolve(
      jsonResponse({
        photos: [
          streamPhoto("OLDER", {
            dateCreated: "2025-01-01T00:00:00Z",
            batchDateCreated: "2025-01-01T00:00:00Z",
          }),
          streamPhoto("VIDEO", { mediaAssetType: "video" }),
          streamPhoto("NEWER", {
            dateCreated: "2026-06-01T00:00:00Z",
            batchDateCreated: "2026-06-01T00:00:00Z",
            derivatives: {
              small: { checksum: "small-chk", fileSize: "1", width: "400", height: "300" },
              large: { checksum: "large-chk", fileSize: "1", width: "1536", height: "1024" },
            },
          }),
        ],
      }),
    );
  });
  const original = globalThis.fetch;
  globalThis.fetch = fetchStub as unknown as typeof fetch;
  try {
    const photos = await fetchAlbum(TOKEN);
    assertEquals(photos.map((p) => p.guid), ["NEWER", "OLDER"]); // video filtered, newest first
    const newer = photos[0];
    assertEquals(newer.checksum, "large-chk"); // largest derivative by width
    assertEquals(newer.width, 1536);
  } finally {
    globalThis.fetch = original;
  }
  assertSpyCalls(fetchStub, 1);
});

Deno.test("fetchAlbum: sorts batchDateCreated desc, then dateCreated desc, then guid desc", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    return Promise.resolve(
      jsonResponse({
        photos: [
          // Same batch, tiebreak on dateCreated.
          streamPhoto("B-EARLY", {
            batchDateCreated: "2026-03-01T00:00:00Z",
            dateCreated: "2026-01-01T00:00:00Z",
          }),
          streamPhoto("B-LATE", {
            batchDateCreated: "2026-03-01T00:00:00Z",
            dateCreated: "2026-02-01T00:00:00Z",
          }),
          // Same batch and dateCreated, tiebreak on guid.
          streamPhoto("Z-GUID", {
            batchDateCreated: "2026-04-01T00:00:00Z",
            dateCreated: "2026-01-01T00:00:00Z",
          }),
          streamPhoto("A-GUID", {
            batchDateCreated: "2026-04-01T00:00:00Z",
            dateCreated: "2026-01-01T00:00:00Z",
          }),
        ],
      }),
    );
  }) as unknown as typeof fetch;
  try {
    const photos = await fetchAlbum(TOKEN);
    assertEquals(photos.map((p) => p.guid), ["Z-GUID", "A-GUID", "B-LATE", "B-EARLY"]);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("fetchAlbum: 330 redirect names the real host via header, memoised across calls", async () => {
  let calls = 0;
  const seenHosts: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL) => {
    calls++;
    const url = new URL(input);
    seenHosts.push(url.host);
    if (url.host === "p01-sharedstreams.icloud.com") {
      return Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 330,
          headers: { "X-Apple-MMe-Host": "p42-sharedstreams.icloud.com" },
        }),
      );
    }
    return Promise.resolve(jsonResponse({ photos: [streamPhoto("G1")] }));
  }) as unknown as typeof fetch;
  try {
    const first = await fetchAlbum(TOKEN);
    assertEquals(first.map((p) => p.guid), ["G1"]);
    assertEquals(seenHosts, ["p01-sharedstreams.icloud.com", "p42-sharedstreams.icloud.com"]);

    // Second call: no fresh contact with p01 — the memoised host is used directly.
    seenHosts.length = 0;
    await fetchAlbum(TOKEN);
    assertEquals(seenHosts, ["p42-sharedstreams.icloud.com"]);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("fetchAlbum: non-OK status throws", async () => {
  const original = globalThis.fetch;
  globalThis.fetch =
    (() => Promise.resolve(new Response("nope", { status: 500 }))) as unknown as typeof fetch;
  try {
    await assertRejects(() => fetchAlbum(TOKEN), Error, "HTTP 500");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("fetchAssetUrl: signs a CDN URL keyed by the derivative checksum", async () => {
  const photo: AlbumPhoto = {
    guid: "G1",
    dateCreated: "2026-01-01T00:00:00Z",
    batchDateCreated: "2026-01-01T00:00:00Z",
    width: 1536,
    height: 1024,
    checksum: "the-checksum",
  };
  const original = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      jsonResponse({
        items: {
          "the-checksum": { url_location: "cvws.icloud-content.com", url_path: "/signed/path" },
        },
      }),
    )) as unknown as typeof fetch;
  try {
    const url = await fetchAssetUrl(TOKEN, photo);
    assertEquals(url, "https://cvws.icloud-content.com/signed/path");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("fetchAssetUrl: missing checksum in the response throws", async () => {
  const photo: AlbumPhoto = {
    guid: "G1",
    dateCreated: "2026-01-01T00:00:00Z",
    batchDateCreated: "2026-01-01T00:00:00Z",
    width: 1536,
    height: 1024,
    checksum: "absent-checksum",
  };
  const original = globalThis.fetch;
  globalThis.fetch =
    (() => Promise.resolve(jsonResponse({ items: {} }))) as unknown as typeof fetch;
  try {
    await assertRejects(() => fetchAssetUrl(TOKEN, photo), Error, "no URL for checksum");
  } finally {
    globalThis.fetch = original;
  }
});

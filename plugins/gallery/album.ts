// Client for the unofficial iCloud Shared Album web API — the JSON endpoints
// behind an album's "Public Website" link. No credentials involved: the album
// token (the fragment of the icloud.com/sharedalbum/#… URL) is the only key.
//
// Two calls: `webstream` lists photos with per-derivative metadata;
// `webasseturls` signs short-lived CDN URLs keyed by derivative checksum.
// Both are POSTs. An album may live on any `pNN-sharedstreams` partition; the
// first contact with p01 answers 330 + X-Apple-MMe-Host naming the real one.
// Unofficial but long-stable (probed and verified 2026-07).

export type AlbumPhoto = {
  guid: string;
  // ISO capture timestamp from the stream.
  dateCreated: string;
  // ISO timestamp of when the photo was added to the album (upload batch),
  // distinct from `dateCreated`. Rotation anchors on this, not on capture
  // time, so newly-shared photos surface first regardless of when they were
  // taken.
  batchDateCreated: string;
  // Largest available derivative (typically ~1536 on the short edge).
  width: number;
  height: number;
  // That derivative's checksum — the key `webasseturls` signs URLs under.
  checksum: string;
};

type Derivative = {
  checksum: string;
  fileSize: string;
  width: string;
  height: string;
};

type StreamPhoto = {
  photoGuid: string;
  dateCreated?: string;
  batchDateCreated?: string;
  // "video" for videos; absent for stills.
  mediaAssetType?: string;
  derivatives: Record<string, Derivative>;
};

/**
 * Extract the album token from the "Public Website" link an Apple device
 * shares (`https://www.icloud.com/sharedalbum/#<token>`). Throws for anything
 * that isn't a shared-album URL carrying a fragment.
 */
export function parseAlbumToken(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`not a shared-album link: ${url}`);
  }
  if (parsed.hostname !== "www.icloud.com" || !parsed.pathname.startsWith("/sharedalbum")) {
    throw new Error(`not a shared-album link: ${url}`);
  }
  const token = parsed.hash.slice(1); // drop the leading '#'
  if (token === "") {
    throw new Error(`shared-album link is missing its token fragment: ${url}`);
  }
  return token;
}

// Partition host serving this album (e.g. p113-sharedstreams.icloud.com),
// learned from the 330 redirect once and memoised — partitions are sticky
// per album, so later calls skip the extra round-trip.
let hostCache: string | null = null;

async function callApi(
  token: string,
  path: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  let host = hostCache ?? "p01-sharedstreams.icloud.com";
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://${host}/${token}/sharedstreams/${path}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", "Origin": "https://www.icloud.com" },
      body: JSON.stringify(body),
    });
    if (res.status === 330) {
      // Partition redirect. The replacement host arrives in the header and is
      // mirrored in the JSON body; check both, some responses omit the header.
      const redirect = await res.json();
      const next = res.headers.get("X-Apple-MMe-Host") ??
        (redirect as Record<string, string>)["X-Apple-MMe-Host"];
      if (!next) throw new Error(`icloud ${path}: 330 without X-Apple-MMe-Host`);
      host = next;
      continue;
    }
    if (!res.ok) {
      throw new Error(`icloud ${path}: HTTP ${res.status}`);
    }
    hostCache = host;
    return await res.json();
  }
  throw new Error(`icloud ${path}: too many partition redirects`);
}

/**
 * List the album's stills, each reduced to its largest derivative, sorted
 * newest-first by `batchDateCreated` (when added to the album) — the ordering
 * `rotation.ts`'s anchored pick depends on — with `dateCreated` then `guid`
 * as deterministic tiebreaks.
 */
export async function fetchAlbum(token: string): Promise<AlbumPhoto[]> {
  const stream = await callApi(token, "webstream", { streamCtag: null });
  const photos = (stream.photos ?? []) as StreamPhoto[];

  return photos
    .filter((p) => p.mediaAssetType !== "video")
    .map((p) => {
      const largest = Object.values(p.derivatives).reduce((a, b) =>
        Number(a.width) >= Number(b.width) ? a : b
      );
      return {
        guid: p.photoGuid,
        dateCreated: p.dateCreated ?? "",
        batchDateCreated: p.batchDateCreated ?? "",
        width: Number(largest.width),
        height: Number(largest.height),
        checksum: largest.checksum,
      };
    })
    .sort((a, b) =>
      b.batchDateCreated.localeCompare(a.batchDateCreated) ||
      b.dateCreated.localeCompare(a.dateCreated) ||
      b.guid.localeCompare(a.guid)
    );
}

/**
 * Sign a CDN URL for one photo's largest derivative. The URL expires on the
 * order of an hour, so it is fetched fresh on every `run` and never stored.
 */
export async function fetchAssetUrl(token: string, photo: AlbumPhoto): Promise<string> {
  const assets = await callApi(token, "webasseturls", { photoGuids: [photo.guid] });
  const items = assets.items as
    | Record<string, { url_location: string; url_path: string }>
    | undefined;
  const item = items?.[photo.checksum];
  if (!item) {
    throw new Error(`icloud webasseturls: no URL for checksum ${photo.checksum}`);
  }
  return `https://${item.url_location}${item.url_path}`;
}

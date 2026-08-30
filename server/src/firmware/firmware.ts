import { compare, equals, type SemVer, tryParse } from "@std/semver";
import { parse, type XmlElement, type XmlNode } from "@std/xml";

// Official firmware releases from TRMNL's public S3 bucket
// (usetrmnl.com/api/firmware/latest only answers for the OG model). Release
// keys are `<family>/FW<version>.bin` exactly, which also skips the
// `<family>/dev/…` CI builds. Read by the debug panel (manual "paste latest
// official" button) and by the offer below, which the dashboard drives.

const FIRMWARE_BUCKET = "https://trmnl-fw.s3.us-east-2.amazonaws.com";
const FIRMWARE_FAMILY_BY_MODEL: Record<string, string> = {
  x: "trmnl_x",
  og: "trmnl_og",
};
export const FIRMWARE_MODELS: readonly string[] = Object.keys(FIRMWARE_FAMILY_BY_MODEL);

export type FirmwareRelease = {
  version: SemVer;
  url: string;
};

// The Device-facing firmware offer, in memory only. The dashboard loads the
// release list, picks a version and arms it; the next Device poll takes it and
// disarms it; a restart clears the lot. A poll never touches the network — the
// listing is fetched by the dashboard, not by `/api/display`.
export type FirmwareOffer = {
  // Every official release for the loaded model, newest first. Empty until
  // `load` has succeeded once.
  releases(): readonly FirmwareRelease[];
  // What an armed poll will offer: the operator's pick, or the newest release
  // while they haven't picked one.
  selection(): FirmwareRelease | null;
  // Held as a version and not as a release, so a pick survives a refresh: the
  // reloaded list resolves the same version again, and a list that no longer
  // carries it falls back to the newest release.
  select(version: SemVer): void;
  armed(): boolean;
  arm(): void;
  disarm(): void;
  // Reads the bucket for `model` once; `force` re-reads it. Never throws, and
  // a failed read leaves the releases already in hand alone.
  load(model: string | null, opts?: { force?: boolean }): Promise<void>;
};

export function createFirmwareOffer(deps: { fetch?: typeof fetch } = {}): FirmwareOffer {
  const fetchImpl = deps.fetch ?? fetch;
  let releases: readonly FirmwareRelease[] = [];
  let loadedModel: string | null = null;
  let selected: SemVer | null = null;
  let armed = false;

  return {
    releases: () => releases,
    selection: () => {
      const pick = selected;
      if (pick !== null) {
        const match = releases.find((r) => equals(r.version, pick));
        if (match !== undefined) return match;
      }
      return releases[0] ?? null;
    },
    select: (version) => {
      selected = version;
    },
    armed: () => armed,
    arm: () => {
      armed = true;
    },
    disarm: () => {
      armed = false;
    },
    load: async (model, opts = {}) => {
      if (model === null || (!opts.force && model === loadedModel)) return;
      const found = await listOfficialFirmware(model, fetchImpl);
      if (found.length === 0) return;
      releases = found;
      loadedModel = model;
    },
  };
}

// Newest first. Fetched fresh per call, never throws — an unreachable bucket
// is an empty list. The short timeout keeps callers usable offline. `model` is
// nullable because the Device's reported model is only known once it has
// polled at least once.
export async function listOfficialFirmware(
  model: string | null,
  fetchImpl: typeof fetch,
): Promise<FirmwareRelease[]> {
  const family = FIRMWARE_FAMILY_BY_MODEL[model ?? ""];
  if (!family) return [];
  try {
    const res = await fetchImpl(`${FIRMWARE_BUCKET}/?list-type=2&prefix=${family}/`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return [];
    }
    const xml = await res.text();
    // Every release in the bucket is a plain `major.minor.patch`, so semver
    // both decides what counts as a release key and orders them (1.8.9 <
    // 1.8.10, which a string sort gets backwards). Each URL is rebuilt from
    // the key itself, so it stays byte-identical to the listing.
    const keyPattern = new RegExp(`^${family}/FW(.+)\\.bin$`);
    return parse(xml, { trackPosition: false })
      .root.children
      .filter(isElement)
      .filter((el) => el.name.local === "Contents")
      .flatMap((contents) => contents.children.filter(isElement))
      .filter((el) => el.name.local === "Key")
      .map(elementText)
      .flatMap((key) => {
        const version = tryParse(keyPattern.exec(key)?.[1] ?? "");
        return version === undefined ? [] : [{ version, url: `${FIRMWARE_BUCKET}/${key}` }];
      })
      .sort((a, b) => compare(b.version, a.version));
  } catch {
    return [];
  }
}

function isElement(node: XmlNode): node is XmlElement {
  return node.type === "element";
}

function elementText(el: XmlElement): string {
  return el.children
    .filter((node) => node.type === "text")
    .map((node) => node.text)
    .join("");
}

import { parse, type XmlElement, type XmlNode } from "@std/xml";

// Latest official firmware lookups against TRMNL's public S3 bucket
// (usetrmnl.com/api/firmware/latest only answers for the OG model). Release
// keys are `<family>/FW<dotted-version>.bin` exactly, which also skips the
// `<family>/dev/…` CI builds. Shared by the debug panel (manual "paste
// latest official" button) and the Conductor (optional auto-offer on poll).

const FIRMWARE_BUCKET = "https://trmnl-fw.s3.us-east-2.amazonaws.com";
const FIRMWARE_FAMILY_BY_MODEL: Record<string, string> = {
  x: "trmnl_x",
  og: "trmnl_og",
};
export const FIRMWARE_MODELS: readonly string[] = Object.keys(FIRMWARE_FAMILY_BY_MODEL);

export type LatestFirmware = {
  version: string;
  url: string;
};

// Numeric compare — lexicographic order would put 1.8.9 above 1.8.10.
// Negative when `a` is older than `b`.
export function compareFirmwareVersions(a: string, b: string): number {
  const as = a.split(".").map(Number);
  const bs = b.split(".").map(Number);
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    if ((as[i] ?? 0) !== (bs[i] ?? 0)) return (as[i] ?? 0) - (bs[i] ?? 0);
  }
  return 0;
}

// Fetched fresh per call, never throws — no release, no result. The short
// timeout keeps callers usable offline. `model` is nullable because the
// Device's reported model is only known once it has polled at least once.
export async function latestOfficialFirmware(
  model: string | null,
  fetchImpl: typeof fetch,
): Promise<LatestFirmware | null> {
  const family = FIRMWARE_FAMILY_BY_MODEL[model ?? ""];
  if (!family) return null;
  try {
    const res = await fetchImpl(`${FIRMWARE_BUCKET}/?list-type=2&prefix=${family}/`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    const xml = await res.text();
    const keyPattern = new RegExp(`^${family}/FW(\\d+(?:\\.\\d+)*)\\.bin$`);
    const top = parse(xml, { trackPosition: false })
      .root.children
      .filter(isElement)
      .filter((el) => el.name.local === "Contents")
      .flatMap((contents) => contents.children.filter(isElement))
      .filter((el) => el.name.local === "Key")
      .map(elementText)
      .map((key) => keyPattern.exec(key)?.[1])
      .filter((version) => version !== undefined)
      .sort(compareFirmwareVersions)
      .at(-1);
    return top === undefined
      ? null
      : { version: top, url: `${FIRMWARE_BUCKET}/${family}/FW${top}.bin` };
  } catch {
    return null;
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

// Build identity, assembled from whatever is available so it works the same
// inside the image and on a bare `deno task dev`:
//
// - base semver: the root manifest's "version", statically text-imported and
//   parsed with @std/jsonc + @std/semver. Falls back to 0.0.0 if the field
//   is missing or not valid semver.
// - UTC build instant: baked into a static build-info.json by the Dockerfile
//   (CI passes it as a build arg), so no runtime env vars and no per-build
//   writes to the git checkout. Absent outside the image.
//
// The full version carries the build instant as semver build metadata —
// 0.1.0+20260714113000Z from a CI image, 0.1.0+dev otherwise — constructed
// with @std/semver so it is always a well-formed semver string. Build
// metadata can hold the stamp because it never has to fit in a Docker tag
// ("+" is not a legal tag character): the registry identifies builds by the
// sha tag, the running server by this version.
import { parse as parseJsonc } from "@std/jsonc";
import { format, parse as parseSemVer, type SemVer } from "@std/semver";
import rootManifest from "../../deno.jsonc" with { type: "text" };

export type BuildInfo = {
  version: string;
  builtAt: Temporal.Instant | null;
};

const base: SemVer = (() => {
  try {
    const { version } = parseJsonc(rootManifest) as { version?: unknown };
    return parseSemVer(typeof version === "string" ? version : "0.0.0");
  } catch {
    return parseSemVer("0.0.0");
  }
})();

export async function readBuildInfo(): Promise<BuildInfo> {
  let builtAt: Temporal.Instant | null = null;
  try {
    // Anchored to the workspace root next to deno.jsonc (== /app in the
    // image), not the process cwd.
    const baked = JSON.parse(
      await Deno.readTextFile(new URL("../../build-info.json", import.meta.url)),
    );
    if (baked.date) builtAt = Temporal.Instant.from(baked.date);
  } catch {
    // No baked file (local run) or an unusable date — a dev build.
  }
  const stamp = builtAt === null ? "dev" : builtAt.toString().replace(/[-:T]/g, "");
  return { version: format({ ...base, build: [stamp] }), builtAt };
}

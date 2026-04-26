import { IMAGE_BIT_DEPTH } from "./config.ts";

/** Pipe an RGBA PNG through ImageMagick to produce a grayscale PNG at the
 *  device's native bit depth. TRMNL X firmware accepts 1/2/4-bit grayscale
 *  PNGs via `bitbank2/PNGdec`. */
export async function pngToGrayscalePng(input: Uint8Array): Promise<Uint8Array> {
  const cmd = new Deno.Command("magick", {
    args: [
      "png:-",
      "-colorspace", "Gray",
      "-dither", "FloydSteinberg",
      "-depth", String(IMAGE_BIT_DEPTH),
      "-define", `png:bit-depth=${IMAGE_BIT_DEPTH}`,
      "-define", "png:color-type=0",
      "-strip",
      "png:-",
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const proc = cmd.spawn();
  const writer = proc.stdin.getWriter();
  await writer.write(input);
  await writer.close();
  const { code, stdout, stderr } = await proc.output();
  if (code !== 0) {
    throw new Error(`magick failed (${code}): ${new TextDecoder().decode(stderr)}`);
  }
  return stdout;
}

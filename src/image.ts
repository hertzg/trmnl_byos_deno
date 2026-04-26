import { IMAGE_BIT_DEPTH } from "./config.ts";

/**
 * Convert a chromium-rendered PNG (RGBA, 8-bit) into a TRMNL-X-friendly
 * grayscale PNG of the requested bit depth (1, 2, or 4).
 *
 * Shells out to ImageMagick because:
 *  - The TRMNL docs recommend `magick` for image prep.
 *  - It handles bit-depth, dithering, and PNG palette details correctly.
 *  - Doing 4-bit-grayscale PNG encoding manually in TS would be a lot of code.
 */
export async function pngToGrayscalePng(input: Uint8Array): Promise<Uint8Array> {
  const args = [
    "png:-",
    "-colorspace",
    "Gray",
    "-dither",
    "FloydSteinberg",
    "-depth",
    String(IMAGE_BIT_DEPTH),
    "-define",
    `png:bit-depth=${IMAGE_BIT_DEPTH}`,
    "-define",
    "png:color-type=0",
    "-strip",
    "png:-",
  ];

  const cmd = new Deno.Command("magick", {
    args,
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
    throw new Error(`magick failed (code ${code}): ${new TextDecoder().decode(stderr)}`);
  }
  return stdout;
}

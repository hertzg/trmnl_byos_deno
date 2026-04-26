import { IMAGE_BIT_DEPTH } from "./config.ts";

/** Pipe an RGBA PNG through ImageMagick to produce a grayscale PNG actually
 *  packed at the device's native bit depth. TRMNL X firmware (`bitbank2/PNGdec`)
 *  handles 1/2/4-bit grayscale PNGs only — never 8-bit, even if the palette is
 *  quantized to 16 colors. So we must force `-posterize`/`-colors` to give the
 *  PNG encoder permission to pack pixels tightly. */
export async function pngToGrayscalePng(input: Uint8Array): Promise<Uint8Array> {
  const levels = 2 ** IMAGE_BIT_DEPTH;
  const cmd = new Deno.Command("magick", {
    args: [
      "png:-",
      "-colorspace", "Gray",
      "-dither", "FloydSteinberg",
      "-posterize", String(levels),
      "-colors", String(levels),
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

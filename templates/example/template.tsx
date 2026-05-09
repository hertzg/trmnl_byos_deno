/** @jsxImportSource hono/jsx */

export type DefaultProps = {
  time: string;
  hostname: string;
  /** dither mode name, or "(preview)" for the / route */
  dither: string;
  /** bit depth, or "—" placeholder for the / route */
  bitDepth: number | "—";
  width: number;
  height: number;
  dpr: number;
};

export default function DefaultTemplate(props: DefaultProps) {
  const { time, hostname, dither, bitDepth, width, height, dpr } = props;
  const deviceW = Math.round(width * dpr);
  const deviceH = Math.round(height * dpr);

  const bands = Array.from({ length: 16 }, (_, i) => {
    const v = Math.round((i / 15) * 255).toString(16).padStart(2, "0");
    return <div key={i} style={`background:#${v}${v}${v}`} />;
  });

  const footerQuery = new URLSearchParams({
    dither: String(dither),
    bitDepth: String(bitDepth),
  }).toString();

  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Dither Test Card</title>
        <link rel="stylesheet" href="/assets/style.css" />
      </head>
      <body>
        <div class="banner">
          <h1>Dither Test Card</h1>
          <div class="params">
            <span>
              <b>dither:</b> <span class="pill">{dither}</span>
            </span>
            <span>
              <b>depth:</b> <span class="pill">{bitDepth}-bit</span>
            </span>
            <span>
              <b>render:</b> {width}×{height} @ {dpr}x → {deviceW}×{deviceH}
            </span>
          </div>
        </div>

        <div>
          <div class="label">
            A · Smooth gradient{" "}
            <span class="hint">— banding visibility / serpentine artifacts</span>
          </div>
          <div class="gradient"></div>
        </div>

        <div>
          <div class="label">
            B · Quantization buckets{" "}
            <span class="hint">
              — the 16 levels of 4-bit (5/100% etc.) — flat in “none” mode
            </span>
          </div>
          <div class="bands">{bands}</div>
        </div>

        <div>
          <div class="label">
            C · Continuous tone &amp; type{" "}
            <span class="hint">
              — photo-like falloff (left) vs text legibility at 4 sizes (right)
            </span>
          </div>
          <div class="row-spheres-type">
            <div class="spheres">
              <div class="sphere sphere-1"></div>
              <div class="sphere sphere-2"></div>
              <div class="sphere sphere-3"></div>
            </div>
            <div class="type">
              <div class="type-xl">Sphinx of black quartz</div>
              <div class="type-md">judge my vow — 0123456789</div>
              <div class="type-sm">
                Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
                incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud
                exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
              </div>
              <div class="type-xs">
                9px stress: The five boxing wizards jump quickly. Pack my box with five dozen liquor
                jugs.
              </div>
            </div>
          </div>
        </div>

        <div>
          <div class="label">
            D · Mid-tones{" "}
            <span class="hint">— Atkinson lightens these vs Floyd-Steinberg (its signature)</span>
          </div>
          <div class="midtones">
            <div style="background:#404040">25%</div>
            <div style="background:#808080">50%</div>
            <div style="background:#a0a0a0">62%</div>
            <div style="background:#c0c0c0">75%</div>
          </div>
        </div>

        <div>
          <div class="label">
            E · Fine patterns{" "}
            <span class="hint">
              — Bayer's matrix interferes with these; error-diffusion handles them cleanly
            </span>
          </div>
          <div class="patterns">
            <div class="pattern lines-h-1" data-label="1px H"></div>
            <div class="pattern lines-v-1" data-label="1px V"></div>
            <div class="pattern checker-1" data-label="1px X"></div>
            <div class="pattern stripes-d" data-label="3px /"></div>
            <div class="pattern grays-strip" data-label="bands"></div>
          </div>
        </div>

        <div class="footer">
          <span>
            {hostname} · {time}
          </span>
          <span>
            <code>/image.png?{footerQuery}</code>
          </span>
        </div>
      </body>
    </html>
  );
}

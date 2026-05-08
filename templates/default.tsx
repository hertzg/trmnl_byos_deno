/** @jsxImportSource hono/jsx */

const css = `
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    width: 1040px; height: 780px;
    padding: 14px 16px;
    box-sizing: border-box;
    font-family: -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
    display: flex; flex-direction: column; gap: 8px;
  }

  .banner {
    display: flex; align-items: baseline; justify-content: space-between;
    border-bottom: 2px solid #000;
    padding-bottom: 6px;
  }
  .banner h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
  .banner .params {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 13px;
    display: flex; gap: 12px;
  }
  .banner .params b { font-weight: 700; }
  .pill {
    display: inline-block;
    padding: 1px 8px;
    border: 1.5px solid #000;
    border-radius: 4px;
    font-weight: 700;
  }

  .label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #000;
    margin-bottom: 2px;
  }
  .label .hint { font-weight: 400; color: #666; text-transform: none; letter-spacing: 0; }

  .gradient {
    height: 36px;
    background: linear-gradient(to right, #000, #fff);
    border: 1px solid #000;
  }

  .bands { display: flex; height: 28px; border: 1px solid #000; }
  .bands > div { flex: 1; }

  .row-spheres-type {
    display: flex; gap: 14px; height: 168px;
  }
  .spheres { display: flex; gap: 10px; }
  .sphere { width: 160px; height: 160px; border-radius: 50%; }
  .sphere-1 { background: radial-gradient(circle at 30% 25%, #fff 0%, #888 45%, #000 100%); }
  .sphere-2 { background: radial-gradient(circle at 50% 50%, #fff 0%, #444 70%); }
  .sphere-3 { background: radial-gradient(ellipse at 70% 30%, #fff 0%, #aaa 30%, #222 80%); }

  .type {
    flex: 1; min-width: 0;
    display: flex; flex-direction: column; gap: 6px; justify-content: center;
  }
  .type-xl { font-size: 32px; font-weight: 700; letter-spacing: -0.02em; line-height: 1; }
  .type-md { font-size: 16px; font-weight: 500; }
  .type-sm { font-size: 11px; line-height: 1.4; color: #222; }
  .type-xs { font-size: 9px; line-height: 1.3; color: #444; }

  .midtones { display: flex; gap: 4px; height: 36px; }
  .midtones > div {
    flex: 1; display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 600;
    color: #fff; mix-blend-mode: difference;
  }

  .patterns { display: flex; gap: 6px; height: 70px; }
  .pattern { flex: 1; border: 1px solid #000; position: relative; }
  .pattern::after {
    content: attr(data-label);
    position: absolute; bottom: 2px; right: 4px;
    font-size: 9px; padding: 1px 3px; background: #fff; color: #000;
    border: 1px solid #000;
  }
  .lines-h-1 { background: repeating-linear-gradient(0deg, #000 0 1px, #fff 1px 2px); }
  .lines-v-1 { background: repeating-linear-gradient(90deg, #000 0 1px, #fff 1px 2px); }
  .checker-1 {
    background-image:
      repeating-linear-gradient(0deg, #000 0 1px, transparent 1px 2px),
      repeating-linear-gradient(90deg, #000 0 1px, transparent 1px 2px);
  }
  .stripes-d { background: repeating-linear-gradient(45deg, #000 0 3px, #fff 3px 6px); }
  .grays-strip {
    background: linear-gradient(to right,
      #000 0% 20%,
      #444 20% 40%,
      #888 40% 60%,
      #c0c0c0 60% 80%,
      #fff 80% 100%);
  }

  .footer {
    margin-top: auto;
    display: flex; justify-content: space-between; align-items: baseline;
    border-top: 1px solid #000;
    padding-top: 4px;
    font-size: 10px;
    color: #444;
  }
  .footer code { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
`;

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
        <style dangerouslySetInnerHTML={{ __html: css }} />
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

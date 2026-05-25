import { connect } from "@astral/astral";
import { timed } from "../../telemetry/spans.ts";

export type Browser = Awaited<ReturnType<typeof connect>>;

type Cdp = ReturnType<
  Awaited<
    ReturnType<Browser["newPage"]>
  >["unsafelyGetCelestialBindings"]
>;

// Wait for a specific CDP Page.lifecycleEvent (e.g. "firstContentfulPaint", "networkIdle").
function waitForLifecycleEvent(cdp: Cdp, name: string): Promise<void> {
  return new Promise((resolve) => {
    const handler: EventListener = (e) => {
      if ((e as CustomEvent<{ name: string }>).detail.name !== name) return;
      cdp.removeEventListener("Page.lifecycleEvent", handler);
      resolve();
    };
    cdp.addEventListener("Page.lifecycleEvent", handler);
  });
}

export interface RenderOptions {
  // A connected Astral Browser owned by the caller. We never close it here —
  // its lifetime is process-scoped (held across many renders).
  browser: Browser;
  url: string;

  deviceWidth: number;
  deviceHeight: number;
  deviceScaleFactor: number;
}

// Resolves a CDP HTTP base (e.g. http://browser:9222) to its per-process WebSocket endpoint.
export async function resolveCdpEndpoint(cdpUrl: string | URL): Promise<string> {
  const r = await fetch(new URL("/json/version", cdpUrl));
  if (!r.ok) throw new Error(`CDP /json/version ${r.status}`);
  const { webSocketDebuggerUrl } = await r.json();
  if (!webSocketDebuggerUrl) {
    throw new Error("CDP /json/version missing webSocketDebuggerUrl");
  }
  return webSocketDebuggerUrl;
}

// Navigates the headless browser to `url` (typically our own server's render endpoint),
// waits for FCP, captures via direct CDP, and returns the PNG screenshot bytes. Going
// through a real HTTP fetch (vs. setContent) means relative asset URLs in the HTML
// resolve naturally — that's what enables /assets/style.css and friends.
//
// We bypass Astral's `page.screenshot()` in favor of `cdp.Page.captureScreenshot()`
// + `Uint8Array.fromBase64` because the Astral helper does an `atob → number[] →
// Uint8Array` dance in JS that's measurably slower than the native base64 decoder.
//
// Per-step durations land on the request's ALS span buffer (see telemetry/spans.ts)
// and surface as Server-Timing entries when invoked inside the Hono pipeline.
export async function renderUrl(opts: RenderOptions): Promise<Uint8Array<ArrayBuffer>> {
  const { browser, url, deviceWidth, deviceHeight, deviceScaleFactor } = opts;

  const page = await timed("newPage", () => browser.newPage(undefined, {}));
  try {
    // setViewportSize hardcodes deviceScaleFactor=0; go direct to set our DPR.
    const cdp = page.unsafelyGetCelestialBindings();

    await timed("setup", () =>
      Promise.all([
        cdp.Emulation.setDeviceMetricsOverride({
          width: deviceWidth,
          height: deviceHeight,
          deviceScaleFactor,
          mobile: false,
        }),
        cdp.Page.setLifecycleEventsEnabled({ enabled: true }),
      ]));

    // Wire the FCP listener BEFORE goto so we don't miss the event. We deliberately
    // do not await networkIdle (Chrome's "0 in-flight for 500 ms" definition): our
    // loopback origin serves assets from memory, so the graph is settled by FCP and
    // the quiet-period wait would just add ~500 ms of dead air per render.
    const fcp = waitForLifecycleEvent(cdp, "firstContentfulPaint");
    await timed("goto", () => page.goto(url, { waitUntil: "none" }));
    await timed("fcp", () => fcp);

    const { data } = await timed("screenshot", () =>
      cdp.Page.captureScreenshot({
        format: "png",
        // ~25 ms saved on a 2.6 Mpx render — Chrome calls zlib with Z_BEST_SPEED.
        // Lossless: same pixels, larger wire payload (loopback, free).
        optimizeForSpeed: true,
      }));

    return Uint8Array.fromBase64(data);
  } finally {
    // Close only the Page; the Browser is owned by the caller and survives
    // many renders. Closes the per-render tab and frees its memory in Chrome
    // — does not affect the WS connection or other concurrent pages.
    await timed("closePage", () => page.close());
  }
}

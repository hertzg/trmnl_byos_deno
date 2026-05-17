import { connect } from "@astral/astral";
import { timed } from "./timings.ts";

type Cdp = ReturnType<
  Awaited<
    ReturnType<Awaited<ReturnType<typeof connect>>["newPage"]>
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
  endpoint: string;
  url: string;

  deviceWidth: number;
  deviceHeight: number;
  deviceScaleFactor: number;
}

// Resolves a CDP HTTP base (e.g. http://browser:9222) to its per-process WebSocket endpoint.
export async function resolveCdpEndpoint(cdpUrl: string | URL): Promise<string> {
  return await timed("cdp.endpoint", async () => {
    const r = await fetch(new URL("/json/version", cdpUrl));
    if (!r.ok) throw new Error(`CDP /json/version ${r.status}`);
    const { webSocketDebuggerUrl } = await r.json();
    if (!webSocketDebuggerUrl) {
      throw new Error("CDP /json/version missing webSocketDebuggerUrl");
    }
    return webSocketDebuggerUrl;
  });
}

// Navigates the headless browser to `url` (typically our own server's render endpoint),
// waits for FCP + networkIdle, and returns a PNG screenshot. Going through a real HTTP
// fetch (vs. setContent) means relative asset URLs in the HTML resolve naturally — that's
// what enables /assets/style.css and friends.
export async function renderUrl(opts: RenderOptions): Promise<Uint8Array> {
  const { endpoint, url, deviceWidth, deviceHeight, deviceScaleFactor } = opts;

  const browser = await timed("cdp.connect", () => connect({ endpoint }));
  try {
    const page = await timed("cdp.newPage", () => browser.newPage());
    // setViewportSize hardcodes deviceScaleFactor=0; go direct to set our DPR.
    const cdp = page.unsafelyGetCelestialBindings();
    await timed("cdp.setMetrics", () =>
      cdp.Emulation.setDeviceMetricsOverride({
        width: deviceWidth,
        height: deviceHeight,
        deviceScaleFactor: deviceScaleFactor,
        mobile: false,
      }));
    await timed("cdp.lifecycleEnable", () => cdp.Page.setLifecycleEventsEnabled({ enabled: true }));

    // Listeners must be wired before goto so we don't miss early events.
    // Each phase is timed separately so callers that collect timings can
    // distinguish actual navigation cost from pure lifecycle-event wait:
    //   - cdp.goto: the page.goto call itself
    //   - cdp.fcp: residual wait for firstContentfulPaint after goto returned
    //     (0ms if the event already fired during goto)
    //   - cdp.networkIdle: residual wait for networkIdle — Chrome's spec
    //     defines this as "0 in-flight requests for 500ms", so this is
    //     where the ~500ms quiet-period floor will show up.
    // Sequential awaits give the same total wall-clock as Promise.all
    // because networkIdle can only fire after FCP.
    const fcp = waitForLifecycleEvent(cdp, "firstContentfulPaint");
    const networkIdle = waitForLifecycleEvent(cdp, "networkIdle");
    await timed("cdp.goto", () => page.goto(url));
    await timed("cdp.fcp", () => fcp);
    await timed("cdp.networkIdle", () => networkIdle);
    return await timed("cdp.screenshot", () => page.screenshot({ format: "png" }));
  } finally {
    // Disconnects the WS; the remote browser process keeps running.
    await timed("cdp.close", () => browser.close());
  }
}

import { connect } from "@astral/astral";

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
  const r = await fetch(new URL("/json/version", cdpUrl));
  if (!r.ok) throw new Error(`CDP /json/version ${r.status}`);
  const { webSocketDebuggerUrl } = await r.json();
  if (!webSocketDebuggerUrl) {
    throw new Error("CDP /json/version missing webSocketDebuggerUrl");
  }
  return webSocketDebuggerUrl;
}

// Navigates the headless browser to `url` (typically our own server's render endpoint),
// waits for FCP + networkIdle, and returns a PNG screenshot. Going through a real HTTP
// fetch (vs. setContent) means relative asset URLs in the HTML resolve naturally — that's
// what enables /assets/style.css and friends.
export async function renderUrl(opts: RenderOptions): Promise<Uint8Array> {
  const { endpoint, url, deviceWidth, deviceHeight, deviceScaleFactor } = opts;

  const browser = await connect({ endpoint });
  try {
    const page = await browser.newPage();
    // setViewportSize hardcodes deviceScaleFactor=0; go direct to set our DPR.
    await page.unsafelyGetCelestialBindings().Emulation.setDeviceMetricsOverride({
      width: deviceWidth,
      height: deviceHeight,
      deviceScaleFactor: deviceScaleFactor,
      mobile: false,
    });
    const cdp = page.unsafelyGetCelestialBindings();
    await cdp.Page.setLifecycleEventsEnabled({ enabled: true });

    // Listeners must be wired before goto so we don't miss early events.
    const fcp = waitForLifecycleEvent(cdp, "firstContentfulPaint");
    const networkIdle = waitForLifecycleEvent(cdp, "networkIdle");

    await page.goto(url);
    await Promise.all([fcp, networkIdle]);

    return await page.screenshot({ format: "png" });
  } finally {
    // Disconnects the WS; the remote browser process keeps running.
    await browser.close();
  }
}

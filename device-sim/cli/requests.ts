import type { Identity, Telemetry } from "../firmware/device.ts";
import { DEFAULT_TELEMETRY } from "../firmware/device.ts";
import { displayHeaders, imageHeaders, logHeaders, setupHeaders } from "../firmware/headers.ts";
import { logBody } from "../firmware/log-entry.ts";
import { request, RequestFailed } from "./http.ts";
import { decodeText, logExchange, printResult } from "./report.ts";
import { previewFile } from "./viewer.ts";

// One function per request the firmware makes. Each builds its headers, sends
// them, and then either dumps the whole exchange (--debug) or prints just its
// own result.

export async function getSetup(
  device: Identity,
  debug: boolean,
): Promise<void> {
  const url = `${device.base}/api/setup`;
  const headers = setupHeaders(device);
  const res = await request("GET", url, { headers });
  const text = await res.text();
  if (debug) {
    logExchange({ method: "GET", url, headers, res, responseBody: text });
  } else printResult(res, text);
}

export async function getDisplay(
  device: Identity,
  state: Telemetry,
  debug: boolean,
): Promise<Record<string, unknown>> {
  const url = `${device.base}/api/display`;
  const headers = displayHeaders(device, state);
  const res = await request("GET", url, { headers });
  const text = await res.text();
  if (debug) {
    logExchange({ method: "GET", url, headers, res, responseBody: text });
  } else printResult(res, text);
  try {
    const parsed = JSON.parse(text);
    // `null` and arrays parse without throwing but are not what the caller
    // was promised, so they get the same empty answer as unparseable text.
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function getImage(
  device: Identity,
  explicitUrl: string | undefined,
  opts: {
    preview: boolean;
    out?: string;
    debug: boolean;
  },
): Promise<void> {
  let url = explicitUrl;
  if (url === undefined) {
    // Same order the firmware uses: /api/display hands back the URL to fetch.
    // Default telemetry is fine here — this poll is only asked for the URL.
    const display = await getDisplay(device, DEFAULT_TELEMETRY, opts.debug);
    if (typeof display.image_url !== "string") {
      throw new RequestFailed(
        "/api/display returned no image_url — pass a URL explicitly",
      );
    }
    url = display.image_url;
    console.log("");
  }

  const headers = imageHeaders(device, url);
  const res = await request("GET", url, { headers });
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (opts.debug) {
    logExchange({
      method: "GET",
      url,
      headers,
      res,
      responseBody: decodeText(res, bytes),
    });
  }
  // Bail rather than save an error page under a .png name and hand it to the
  // viewer; --debug has already shown the body by this point.
  if (!res.ok) {
    throw new RequestFailed(`${url} returned ${res.status}, not an image`);
  }

  const path = opts.out ??
    await Deno.makeTempFile({ prefix: "trmnl-", suffix: ".png" });
  try {
    await Deno.writeFile(path, bytes);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new RequestFailed(`cannot write ${path}\n  ${detail}`);
  }
  console.log(`${bytes.length} bytes`);
  console.log(path);

  if (!opts.preview) return;
  const waited = await previewFile(path);
  // Only reclaim the temp file once the window is closed. Where the viewer
  // does not block, the path stays — it was printed above.
  if (opts.out === undefined && waited) await Deno.remove(path);
}

export async function postLog(
  device: Identity,
  state: Telemetry,
  message: string,
  level: string,
  debug: boolean,
): Promise<void> {
  const url = `${device.base}/api/log`;
  const headers = logHeaders(device);
  const body = logBody(device, state, message, level, Temporal.Now.instant());
  const res = await request("POST", url, { method: "POST", headers, body });
  const text = await res.text();
  if (debug) {
    logExchange({
      method: "POST",
      url,
      headers,
      body,
      res,
      responseBody: text,
    });
  } // /api/log answers 204, so the status is the whole result.
  else console.log(`${res.status} ${res.statusText}`);
}

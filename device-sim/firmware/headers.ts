import type { Identity, Telemetry } from "./device.ts";

// The four header sets the firmware sends, transcribed from its own single
// source of truth: lib/trmnl/src/api-client/request_headers.cpp. Keep these in
// step with that file rather than inventing headers here.

export function setupHeaders(device: Identity): Headers {
  return new Headers({
    "ID": device.id,
    "Content-Type": "application/json",
    "FW-Version": device.fw,
    "Model": device.board.model,
  });
}

export function displayHeaders(device: Identity, state: Telemetry): Headers {
  const headers = new Headers({
    "ID": device.id,
    "Content-Type": "application/json",
    "Update-Source": state.wake,
    "Access-Token": device.token,
    "Refresh-Rate": String(state.refreshRate),
    "Battery-Voltage": String(state.battery),
    // Firmware omits these two when the charger reports UNKNOWN; a healthy
    // board on battery reports them, so the simulator always does.
    "Battery-Charging": "0",
    "USB-Connected": "false",
  });
  if (device.board.gauge) {
    headers.set("Battery-Count", "1");
    headers.set("Percent-Charged", "72");
    headers.set("Battery-Health", "100");
    headers.set("Battery-Current", "-120");
    headers.set("Battery-Temp", "24.5");
    headers.set("Battery-Capacity", "2600/3600");
  }
  headers.set("FW-Version", device.fw);
  headers.set("Model", device.board.model);
  headers.set("Image-Cached", String(state.cached));
  headers.set("Wake-Time", "0");
  headers.set("RSSI", String(state.rssi));
  headers.set("WiFi-Band", "2.4");
  headers.set("Temperature-Profile", "true");
  headers.set("Width", String(device.width));
  headers.set("Height", String(device.height));
  return headers;
}

// The firmware attaches its credentials to the image request only when the
// image lives on the same server as the API (the `strncmp(filename, baseUrl)`
// guard in bl.cpp), so a third-party image host never sees the token.
export function imageHeaders(device: Identity, url: string): Headers {
  const headers = new Headers({ "Accept-Encoding": "identity" });
  if (url.startsWith(device.base)) {
    headers.set("ID", device.id);
    headers.set("Access-Token", device.token);
  }
  return headers;
}

export function logHeaders(device: Identity): Headers {
  return new Headers({
    "ID": device.id,
    "Accept": "application/json, */*",
    "Access-Token": device.token,
    "Content-Type": "application/json",
  });
}

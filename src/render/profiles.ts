import type { DitherMode } from "./dither.ts";

// A device profile bundles every render parameter that varies by panel: physical
// dimensions, the CSS-to-physical scale CDP rasterizes at, the dithered output's
// bit depth, and the dither algorithm tuned for that panel.
export type DeviceProfile = {
  width: number;
  height: number;
  dpr: number;
  bitDepth: 1 | 2 | 4 | 8;
  dither: DitherMode;
};

// Hardcoded registry. Adding a device model is a new entry here, not a sprawl of
// new env vars. TRMNL X panel: 1872x1404 at deviceScaleFactor=1.8 → CSS viewport
// 1040x780 (landscape).
const PROFILES: Record<string, DeviceProfile> = {
  "trmnl-x": {
    width: 1040,
    height: 780,
    dpr: 1.8,
    bitDepth: 4,
    dither: "floyd-steinberg",
  },
};

export function getProfile(id: string): DeviceProfile | undefined {
  return PROFILES[id];
}

export function profileIds(): string[] {
  return Object.keys(PROFILES);
}

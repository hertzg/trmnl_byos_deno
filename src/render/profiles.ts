import type { DitherMode } from "./dither.ts";

// A device profile bundles every render parameter that varies by panel: the panel's
// physical pixel dimensions, the dithered output's bit depth, and the dither algorithm
// tuned for that panel. Templates that use the TRMNL framework CSS handle the
// CSS-to-physical scaling themselves (via `transform: scale(--pixel-ratio)` on .screen),
// so the rasterizer always renders at the panel's native resolution with DPR=1.
export type DeviceProfile = {
  width: number;
  height: number;
  bitDepth: 1 | 2 | 4 | 8;
  dither: DitherMode;
};

// Hardcoded registry. Adding a device model is a new entry here, not a sprawl of new
// env vars.
const PROFILES: Record<string, DeviceProfile> = {
  "trmnl-x": {
    width: 1872,
    height: 1404,
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

import type { DitherMode } from "./_internal/dither.ts";

// Per-panel render parameters. Templates that use the TRMNL framework CSS
// handle CSS-to-physical scaling themselves (`transform: scale(--pixel-ratio)`
// on .screen), so the rasterizer always renders at native res with DPR=1.
export type DeviceProfile = {
  width: number;
  height: number;
  bitDepth: 1 | 2 | 4 | 8;
  dither: DitherMode;
};

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

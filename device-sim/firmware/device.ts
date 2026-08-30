// Who the simulated device claims to be, and what it reports about itself.
// Values here mirror the TRMNL firmware (usetrmnl/trmnl-firmware); when that
// changes, this is the file to update.

// Board differences that reach the wire: DEVICE_MODEL from include/config.h,
// and the panel size the firmware reports from bbep.width()/height(). X-class
// boards additionally send the fuel-gauge headers, which buildDisplayHeaders
// guards behind `#ifdef BOARD_TRMNL_X`.
export const BOARDS = {
  x: { model: "x", width: 1872, height: 1404, gauge: true },
  og: { model: "og", width: 800, height: 480, gauge: false },
} as const;

export type BoardName = keyof typeof BOARDS;
export type Board = typeof BOARDS[BoardName];

// Update-Source values, from the wakeupReasonMap table in
// lib/trmnl/src/logging_parsers.cpp. "timer" is the scheduled wake.
export const WAKE_REASONS = [
  "powercycle",
  "timer",
  "button",
  "touchpad",
  "EXT0",
  "EXT1",
  "ulp",
  "uart",
  "wifi",
  "unknown",
] as const;

// serialize_log.cpp's LogLevel switch.
export const LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;

// The device's identity. Every request reports some of this, so it comes from
// the shared global options rather than per-subcommand ones.
export type Identity = {
  base: string;
  id: string;
  token: string;
  fw: string;
  board: Board;
  width: number;
  height: number;
};

// What the device reports about its current condition. /api/display sends it
// as headers and /api/log repeats most of it in the body, so those two
// subcommands declare these options and the other two don't.
export type Telemetry = {
  wake: string;
  refreshRate: number;
  battery: number;
  rssi: number;
  cached: boolean;
};

export const DEFAULT_TELEMETRY: Telemetry = {
  wake: "timer",
  refreshRate: 900,
  battery: 3.9,
  rssi: -55,
  cached: false,
};

// What the CLI collects before a board is resolved. Width and height are
// optional because they default to the board's own panel.
export type DeviceOptions = {
  base: string;
  id: string;
  token: string;
  fw: string;
  board: BoardName;
  width?: number;
  height?: number;
};

// Resolves the CLI's raw options into an Identity: picks the board, applies
// its panel size unless overridden, and trims the trailing slash so
// `${base}/api/display` never doubles up.
export function identity(options: DeviceOptions): Identity {
  const board = BOARDS[options.board];
  return {
    base: options.base.replace(/\/+$/, ""),
    id: options.id,
    token: options.token,
    fw: options.fw,
    board,
    width: options.width ?? board.width,
    height: options.height ?? board.height,
  };
}

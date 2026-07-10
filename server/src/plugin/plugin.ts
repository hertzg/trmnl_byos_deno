// `id` and `lastSeenAt` are non-nullable because they're guaranteed whenever
// we have a report at all (BYOS firmware always sends `ID`; the parser
// stamps `lastSeenAt` on accept). The rest stay nullable because the
// firmware may genuinely omit those headers.
export type DeviceReport = {
  id: string;
  batteryVoltage: number | null;
  batteryPercent: number | null;
  rssi: number | null;
  fwVersion: string | null;
  model: string | null;
  width: number | null;
  height: number | null;
  refreshRate: number | null;
  lastSeenAt: Temporal.ZonedDateTime;
};

export type RunContext = {
  t: Temporal.ZonedDateTime;
  intent: "poll" | "scrub" | "prerender";
  device: DeviceReport | null;
};

// Optional per-Result hints from the Plugin to the Server.
export type ResultHints = {
  // Opaque assertion of the Result's visual content — "same string ⇒ same
  // pixels". When present, it short-circuits the *whole* identity computed
  // by `Renderer.identity` (not just the filename): it keys both the
  // Device-facing `/api/display` filename and the `/image/<id>.png` URL, so
  // a view whose HTML churns per run (e.g. short-lived signed URLs) stops
  // re-triggering full e-ink redraws of unchanged content. The Server never
  // uses it for caching, Slot reuse, or render skipping (the reuse contract
  // was reverted in 0f5b531 — it pinned stale images). Trap: a Plugin that
  // provides this owns repaint responsibility — pixels that change while
  // the identity stays constant will not repaint on the Device.
  //
  // Composition transfers this ownership silently: a Super-Plugin that
  // spreads a routed leaf's Result (see `composeResult` in
  // plugins/home/compose.ts) inherits the leaf's assertion without ever
  // seeing it. Fine when the composer passes the leaf's view through
  // unwrapped; a composer that wraps it in varying chrome (battery
  // indicator, status bar) must strip or re-derive the inherited
  // `hints.identity`, or the chrome will never repaint.
  //
  // Assertions share one global namespace across all Plugins — prefix with
  // something plugin-unique (Gallery uses `photo:`) so two unrelated
  // Plugins can never collide on the same string.
  identity?: string;
};

export type Result<S> = {
  state: S;
  validity: Temporal.Duration;
  hints?: ResultHints;
  // Method syntax (not arrow property) is purely about variance: it lets the
  // orchestrator type its receive-side as `Result<unknown>` without forcing
  // every Plugin's `Result<MyState>` to be a strict subtype. Authors still
  // write arrow values (`view: (s) => <Card data={s} />`).
  view(state: S): unknown;
};

export type Plugin<S> = {
  run(ctx: RunContext): Result<S> | Promise<Result<S>>;
};

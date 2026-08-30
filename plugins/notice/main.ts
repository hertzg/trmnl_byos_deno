import type { Plugin, Result, RunContext } from "@hztrmnl/server/plugin";
import { encodeBase64 } from "@std/encoding/base64";
import Notice, { type NoticeState } from "./Notice.tsx";
import { inbox } from "./state.ts";

// Re-exported for consumers (e.g. @hztrmnl/home) that import NoticeState by
// package name rather than by file path.
export type { NoticeState };

// The leaf Plugin. It reads the inbox and formats it; the routes are what
// fill the inbox. `run` is a pure read — no stamping, no mutation — so a
// dashboard scrub and a prerender are safe by construction.

// All live notices are on screen at once, capped at the newest five; the rest
// roll up into a single count line.
const MAX_DRAWN = 5;

// What the Result stands for when nothing is live and no expiry bounds it.
const NOMINAL_VALIDITY = Temporal.Duration.from({ hours: 1 });

// ADR-0002 module shape: default-export a Plugin object directly.
export default {
  run(ctx: RunContext): Result<NoticeState> {
    const at = ctx.t.toInstant();
    const live = inbox.live(at);
    const drawn = live.slice(-MAX_DRAWN);
    const nextExpiry = inbox.nextExpiry(at);

    return {
      state: {
        notices: drawn.map((notice) => ({
          id: notice.id,
          text: notice.text,
          imageDataUrl: notice.image === null
            ? null
            : `data:${notice.image.mime};base64,${encodeBase64(notice.image.bytes)}`,
          timeLabel: timeLabel(notice.receivedAt, ctx.t.timeZoneId),
        })),
        earlierCount: live.length - drawn.length,
      },
      // Real, not nominal: the frame updates the moment the first notice
      // drops off. An empty inbox has nothing to count down to.
      validity: nextExpiry === null ? NOMINAL_VALIDITY : nextExpiry.since(at),
      view: Notice,
    };
  },
} satisfies Plugin<NoticeState>;

// When the notice was *sent*, which is what a message thread labels its
// bubbles with. The one place the zone matters, and it comes from the
// RunContext rather than from a zone of this Plugin's own.
function timeLabel(receivedAt: Temporal.Instant, timeZone: string): string {
  return receivedAt
    .toZonedDateTimeISO(timeZone)
    .toPlainTime()
    .toString({ smallestUnit: "minute" });
}

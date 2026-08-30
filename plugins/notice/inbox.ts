// The entire state of the notice feature: an array in a closure.
//
// A dumb store. It reads no clock and decides nothing about when a notice's
// life begins — the caller hands it both instants. Expiry is an absolute-time
// question, so this module needs no timezone and no Clock port; formatting a
// wall-clock label is the view's job.

export type NoticeImage = { mime: string; bytes: Uint8Array };

export type Notice = {
  id: string;
  text: string;
  image: NoticeImage | null;
  /** When it was sent — this is what the bubble labels. */
  receivedAt: Temporal.Instant;
  /** Computed by the caller: the next expected poll plus the requested minutes. */
  expiresAt: Temporal.Instant;
};

export type Inbox = {
  add(input: {
    text: string;
    image?: NoticeImage;
    receivedAt: Temporal.Instant;
    expiresAt: Temporal.Instant;
  }): Notice;
  /**
   * Live notices in arrival order, oldest first. A pure filter: entries whose
   * `expiresAt` has been reached are omitted, never deleted. The boundary is
   * exclusive.
   */
  live(at: Temporal.Instant): Notice[];
  /** The earliest expiry strictly after `at`, or `null` when nothing is live. */
  nextExpiry(at: Temporal.Instant): Temporal.Instant | null;
  /** `false` when the id is unknown. */
  remove(id: string): boolean;
  clear(): void;
};

/**
 * The default lifetime a sender gets when it names no duration. Written here
 * once, applied by the route — the inbox itself never reads it.
 */
export const DEFAULT_MINUTES = 15;

export function createInbox(): Inbox {
  let notices: Notice[] = [];

  return {
    add(input) {
      const notice: Notice = {
        id: crypto.randomUUID(),
        text: input.text,
        image: input.image ?? null,
        receivedAt: input.receivedAt,
        expiresAt: input.expiresAt,
      };
      notices.push(notice);
      return notice;
    },

    live(at) {
      // Reads, never writes: the dashboard runs Plugins at an arbitrary
      // scrubbed instant, so a `live()` that pruned would let a read-only
      // debug surface delete real notices. Nothing garbage-collects the
      // expired entries — a handful in memory, emptied by the next restart.
      return notices.filter((notice) => Temporal.Instant.compare(notice.expiresAt, at) > 0);
    },

    nextExpiry(at) {
      const future = notices
        .map((notice) => notice.expiresAt)
        .filter((expiresAt) => Temporal.Instant.compare(expiresAt, at) > 0)
        .sort(Temporal.Instant.compare);
      return future[0] ?? null;
    },

    remove(id) {
      const before = notices.length;
      notices = notices.filter((notice) => notice.id !== id);
      return notices.length < before;
    },

    clear() {
      notices = [];
    },
  };
}

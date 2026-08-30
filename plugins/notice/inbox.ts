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
   * Live notices in arrival order, oldest first. Drops — and prunes — every
   * entry whose `expiresAt` has been reached; the boundary is exclusive.
   */
  live(at: Temporal.Instant): Notice[];
};

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
      notices = notices.filter((notice) => Temporal.Instant.compare(notice.expiresAt, at) > 0);
      return [...notices];
    },
  };
}

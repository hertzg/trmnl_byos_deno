import type { Bundle } from "../plugin/bundle.ts";

// A Slot entry holds everything the Conductor pushed in when the latest
// Bundle landed: the Bundle itself, its identity (so Slot can answer
// `image(id)` without re-hashing), and the eagerly-started rasterize
// promise (so the second caller awaits the same work as the first).
// `cachedAt` is recorded when the entry lands; `display()` derives
// `refreshIn` from `cachedAt + bundle.result.validity`.
export type SlotEntry = {
  identity: string;
  bundle: Bundle;
  cachedAt: Temporal.ZonedDateTime;
  image: Promise<Uint8Array>;
};

export type SlotDeps = {
  now: () => Temporal.ZonedDateTime;
};

export type SlotDisplay = {
  identity: string;
  refreshIn: Temporal.Duration;
};

export type Slot = {
  put(entry: SlotEntry): void;
  display(): SlotDisplay | null;
  image(id: string): Promise<Uint8Array | null>;
  clear(): void;
};

export function createSlot(_deps: SlotDeps): Slot {
  return {
    put(_entry) {},
    display() {
      return null;
    },
    image(_id) {
      return Promise.resolve(null);
    },
    clear() {},
  };
}

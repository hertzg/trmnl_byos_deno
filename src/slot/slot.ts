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

export function createSlot(deps: SlotDeps): Slot {
  let entry: SlotEntry | null = null;

  return {
    put(next) {
      entry = next;
    },
    display() {
      if (entry === null) return null;
      const expiresAt = entry.cachedAt.add(entry.bundle.result.validity);
      const now = deps.now();
      if (Temporal.ZonedDateTime.compare(now, expiresAt) >= 0) return null;
      return { identity: entry.identity, refreshIn: expiresAt.since(now) };
    },
    image(_id) {
      return Promise.resolve(null);
    },
    clear() {},
  };
}

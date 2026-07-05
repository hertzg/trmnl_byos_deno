import type { Bundle } from "../plugin/bundle.ts";

// Single-Image cache. See ADR-0004.

export type SlotEntry = {
  identity: string;
  bundle: Bundle;
  cachedAt: Temporal.ZonedDateTime;
  image: Promise<Uint8Array<ArrayBuffer>>;
};

export type SlotDeps = {
  now: () => Temporal.ZonedDateTime;
};

export type SlotDisplay = {
  identity: string;
  cachedAt: Temporal.ZonedDateTime;
  refreshIn: Temporal.Duration;
};

export type Slot = {
  put(entry: SlotEntry): void;
  display(): SlotDisplay | null;
  image(id: string): Promise<Uint8Array<ArrayBuffer> | null>;
  // The stored entry regardless of validity expiry — unlike display()/image(),
  // which refuse an expired entry, this is for the Conductor's reuse check
  // (Result.hints.identity/holdIdentity), where an expired-but-matching
  // identity should still be reused rather than re-rendered.
  last(): SlotEntry | null;
  clear(): void;
};

export function createSlot(deps: SlotDeps): Slot {
  let entry: SlotEntry | null = null;

  function expiryOf(e: SlotEntry): Temporal.ZonedDateTime {
    return e.cachedAt.add(e.bundle.result.validity);
  }

  function isStillValid(e: SlotEntry, now: Temporal.ZonedDateTime): boolean {
    return Temporal.ZonedDateTime.compare(now, expiryOf(e)) < 0;
  }

  return {
    put(next) {
      entry = next;
    },
    display() {
      if (entry === null) return null;
      const now = deps.now();
      if (!isStillValid(entry, now)) return null;
      return {
        identity: entry.identity,
        cachedAt: entry.cachedAt,
        refreshIn: expiryOf(entry).since(now),
      };
    },
    async image(id) {
      if (entry === null) return null;
      if (!isStillValid(entry, deps.now())) return null;
      if (entry.identity !== id) return null;
      return await entry.image;
    },
    last() {
      return entry;
    },
    clear() {
      entry = null;
    },
  };
}

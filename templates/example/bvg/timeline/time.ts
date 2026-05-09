// Wall-clock hour/minute in the user's transit timezone. Both Timeline (to decide the
// hour-collapse variant) and TimePill (to format its own label) need this — keeping it
// here lets the pill stay self-contained without forcing the timeline to double-parse.

const BERLIN_TZ = "Europe/Berlin";

export function hourMinute(iso: string): { hh: string; mm: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BERLIN_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  return {
    hh: parts.find((p) => p.type === "hour")?.value ?? "00",
    mm: parts.find((p) => p.type === "minute")?.value ?? "00",
  };
}

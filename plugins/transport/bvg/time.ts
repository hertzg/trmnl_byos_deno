// HH:MM formatting in Berlin time. The display is always in Europe/Berlin regardless
// of where the BYOS runs, so DST and TZ offset are handled by Intl rather than ad-hoc
// arithmetic.

const BERLIN_TZ = "Europe/Berlin";

const HHMM = new Intl.DateTimeFormat("en-GB", {
  timeZone: BERLIN_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatHHMM(iso: string | Date): string {
  return HHMM.format(typeof iso === "string" ? new Date(iso) : iso);
}

// Deno's built-in Intl data falls back to en-US for ka/ka-GE (no Georgian
// weekday/month strings ship with the runtime). Hand-rolled tables so the
// panel stays in Georgian for the chrome that the user explicitly wanted
// localised. Sunday-first; matches `Date.getDay()` indexing (0 = Sunday).
const KA_WEEKDAYS_SHORT = ["კვი", "ორშ", "სამ", "ოთხ", "ხუთ", "პარ", "შაბ"] as const;
const KA_MONTHS_SHORT = [
  "იან",
  "თებ",
  "მარ",
  "აპრ",
  "მაი",
  "ივნ",
  "ივლ",
  "აგვ",
  "სექ",
  "ოქტ",
  "ნოე",
  "დეკ",
] as const;

// `weekday`/`day`/`month` parts of a Date in Berlin TZ, in Georgian. We
// extract the calendar fields via Intl (so DST is honoured) and look the
// localized strings up in our own table.
const BERLIN_DOW = new Intl.DateTimeFormat("en-GB", {
  timeZone: BERLIN_TZ,
  weekday: "short",
});
const BERLIN_DAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: BERLIN_TZ,
  day: "numeric",
});
const BERLIN_MONTH_INDEX = new Intl.DateTimeFormat("en-US", {
  timeZone: BERLIN_TZ,
  month: "2-digit",
});

const EN_DOW_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function formatKaWeekday(d: Date): string {
  const idx = EN_DOW_TO_INDEX[BERLIN_DOW.format(d)] ?? 0;
  return KA_WEEKDAYS_SHORT[idx];
}

export function formatKaDate(d: Date): string {
  const day = BERLIN_DAY.format(d);
  const monthIdx = Number.parseInt(BERLIN_MONTH_INDEX.format(d), 10) - 1;
  return `${formatKaWeekday(d)}, ${day} ${KA_MONTHS_SHORT[monthIdx]}`;
}

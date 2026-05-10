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

// The Server's single seam onto wall-clock time. Every module that needs "now"
// takes a Clock in its deps so tests can pin it to a fixed moment; only the
// composition root reaches for the real one.

export type Clock = () => Temporal.ZonedDateTime;

// The Device's wall clock, in the configured zone. Everything downstream reads
// the zone back off the moment (`now().timeZoneId`), so it travels with it.
export function systemClock(timeZone: string): Clock {
  return () => Temporal.Now.zonedDateTimeISO(timeZone);
}

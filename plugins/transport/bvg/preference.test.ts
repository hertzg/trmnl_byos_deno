import { assertEquals } from "@std/assert";
import { DEFAULTS, type Preference, resolveTunables, type ScheduleRule } from "./preference.ts";

const STOP = {
  hafasStopId: "0",
  displayName: "X",
  walkingMinutesBetweenStopAndAddress: 0,
} as const;

function makePreference(overrides: Partial<Preference> = {}): Preference {
  return {
    preferenceKey: "p",
    rowIcon: "P",
    rowLabel: "P",
    origin: STOP,
    destination: STOP,
    schedule: [],
    ...overrides,
  };
}

function makeRule(overrides: Partial<ScheduleRule> = {}): ScheduleRule {
  return {
    applicableDays: ["mon"],
    arriveByLocalTime: "09:30",
    showFromLocalTime: "07:30",
    ...overrides,
  };
}

Deno.test("resolveTunables falls through to DEFAULTS when nothing is set", () => {
  const t = resolveTunables(makePreference(), makeRule());
  assertEquals(t.windowLateTailMinutes, DEFAULTS.windowLateTailMinutes);
  assertEquals(t.imminentDepartureGraceMinutes, DEFAULTS.imminentDepartureGraceMinutes);
  assertEquals(t.preparationMinutes, DEFAULTS.preparationMinutes);
  assertEquals(t.excludedLineNames, DEFAULTS.excludedLineNames);
});

Deno.test("resolveTunables cascade: windowLateTailMinutes", () => {
  assertEquals(
    resolveTunables(makePreference({ windowLateTailMinutes: 20 }), makeRule())
      .windowLateTailMinutes,
    20,
  );
  assertEquals(
    resolveTunables(
      makePreference({ windowLateTailMinutes: 20 }),
      makeRule({ windowLateTailMinutesOverride: 5 }),
    ).windowLateTailMinutes,
    5,
  );
  // Explicit 0 stops the chain.
  assertEquals(
    resolveTunables(
      makePreference({ windowLateTailMinutes: 20 }),
      makeRule({ windowLateTailMinutesOverride: 0 }),
    ).windowLateTailMinutes,
    0,
  );
});

Deno.test("resolveTunables cascade: imminentDepartureGraceMinutes", () => {
  assertEquals(
    resolveTunables(
      makePreference({ imminentDepartureGraceMinutes: 7 }),
      makeRule(),
    ).imminentDepartureGraceMinutes,
    7,
  );
  assertEquals(
    resolveTunables(
      makePreference({ imminentDepartureGraceMinutes: 7 }),
      makeRule({ imminentDepartureGraceMinutesOverride: 2 }),
    ).imminentDepartureGraceMinutes,
    2,
  );
  // Explicit 0 stops the chain.
  assertEquals(
    resolveTunables(
      makePreference({ imminentDepartureGraceMinutes: 7 }),
      makeRule({ imminentDepartureGraceMinutesOverride: 0 }),
    ).imminentDepartureGraceMinutes,
    0,
  );
});

Deno.test("resolveTunables cascade: preparationMinutes", () => {
  assertEquals(
    resolveTunables(makePreference({ preparationMinutes: 10 }), makeRule()).preparationMinutes,
    10,
  );
  assertEquals(
    resolveTunables(
      makePreference({ preparationMinutes: 10 }),
      makeRule({ preparationMinutesOverride: 25 }),
    ).preparationMinutes,
    25,
  );
  // Explicit 0 stops the chain.
  assertEquals(
    resolveTunables(
      makePreference({ preparationMinutes: 10 }),
      makeRule({ preparationMinutesOverride: 0 }),
    ).preparationMinutes,
    0,
  );
});

Deno.test("resolveTunables cascade: excludedLineNames (empty array stops the chain)", () => {
  // Preference overrides DEFAULTS.
  assertEquals(
    resolveTunables(
      makePreference({ excludedLineNames: ["BUS", "FEX"] }),
      makeRule(),
    ).excludedLineNames,
    ["BUS", "FEX"],
  );
  // Rule overrides preference.
  assertEquals(
    resolveTunables(
      makePreference({ excludedLineNames: ["BUS", "FEX"] }),
      makeRule({ excludedLineNamesOverride: ["U2"] }),
    ).excludedLineNames,
    ["U2"],
  );
  // Explicit empty array on rule clears inherited preference list — does not fall through.
  assertEquals(
    resolveTunables(
      makePreference({ excludedLineNames: ["BUS", "FEX"] }),
      makeRule({ excludedLineNamesOverride: [] }),
    ).excludedLineNames,
    [],
  );
  // undefined on rule falls through to preference.
  assertEquals(
    resolveTunables(
      makePreference({ excludedLineNames: ["BUS"] }),
      makeRule({ excludedLineNamesOverride: undefined }),
    ).excludedLineNames,
    ["BUS"],
  );
});

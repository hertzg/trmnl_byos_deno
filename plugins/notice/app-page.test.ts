import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { appPage } from "./app-page.ts";

Deno.test("the Home Screen icon is a PNG data URI", () => {
  // iOS ignores an SVG in apple-touch-icon and falls back to a screenshot of
  // the page, so this has to be a PNG.
  assertMatch(
    appPage,
    /<link rel="apple-touch-icon" href="data:image\/png;base64,[A-Za-z0-9+/=]+">/,
  );
});

Deno.test("every icon is inline SVG, never a character glyph", () => {
  // The first cut used &#9634; for the photo button; that character *is* a
  // box, and renders as tofu wherever the font lacks it.
  for (const glyph of ["&times;", "&#9634;", "×", "✕", "□", "☰", "✓", "▢"]) {
    assertEquals(appPage.includes(glyph), false, `page still contains ${glyph}`);
  }
  assertStringIncludes(appPage, "<svg");
});

Deno.test("15 min is preselected, and it is the only chip that is", () => {
  // Selection is announced through aria-pressed, so the markup is the whole
  // truth about which duration a send with no interaction gets.
  const pressed = [...appPage.matchAll(/data-minutes="(\d+)" aria-pressed="(\w+)"/g)]
    .filter(([, , state]) => state === "true")
    .map(([, minutes]) => minutes);

  assertEquals(pressed, ["15"]);
});

Deno.test("the page has no HTML-parsing sink for a notice to reach", () => {
  // Not proof on its own that the text is safe — rows are cloned from a
  // <template> and filled with textContent, and that is what makes a stray
  // "<" harmless. This pins the other half: there is no sink to regress into.
  assertEquals(appPage.includes("innerHTML"), false);
  assertEquals(appPage.includes("insertAdjacentHTML"), false);
});

Deno.test("the page installs to the Home Screen fullscreen and titled", () => {
  assertStringIncludes(appPage, '<meta name="apple-mobile-web-app-capable" content="yes">');
  assertStringIncludes(appPage, '<meta name="apple-mobile-web-app-title" content="Frame">');
});

Deno.test("viewport-fit=cover is paired with safe-area padding", () => {
  // One without the other puts content under the notch and the home
  // indicator in standalone mode.
  assertStringIncludes(appPage, "viewport-fit=cover");
  assertStringIncludes(appPage, "env(safe-area-inset-top)");
  assertStringIncludes(appPage, "env(safe-area-inset-bottom)");
});

Deno.test("the theme colour follows the light and dark tokens", () => {
  assertStringIncludes(
    appPage,
    '<meta name="theme-color" content="#f2f4f7" media="(prefers-color-scheme: light)">',
  );
  assertStringIncludes(
    appPage,
    '<meta name="theme-color" content="#101319" media="(prefers-color-scheme: dark)">',
  );
});

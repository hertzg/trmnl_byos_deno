/** @jsxImportSource hono/jsx */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { deriveHtml } from "./derive.ts";

Deno.test("deriveHtml invokes the Result's view with its state and prefixes <!DOCTYPE html>", () => {
  const html = deriveHtml({
    state: { greeting: "hello world" },
    validity: Temporal.Duration.from({ minutes: 1 }),
    view: (s: { greeting: string }) => <p>{s.greeting}</p>,
  });

  assertEquals(html.startsWith("<!DOCTYPE html>"), true);
  assertStringIncludes(html, "hello world");
  assertStringIncludes(html, "<p");
});

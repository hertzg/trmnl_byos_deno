/** @jsxImportSource hono/jsx */
import { assertStringIncludes } from "@std/assert";
import { renderToString } from "hono/jsx/dom/server";
import Notice, { type NoticeState } from "./Notice.tsx";

function render(state: NoticeState) {
  // deno-lint-ignore no-explicit-any
  return renderToString(<Notice {...state} /> as any);
}

Deno.test("Notice renders a bubble carrying the notice text", () => {
  const html = render({
    notices: [{
      id: "n-abc123",
      text: "Bread is in the oven",
      imageDataUrl: null,
      timeLabel: "08:12",
    }],
    earlierCount: 0,
  });

  assertStringIncludes(html, "Bread is in the oven");
});

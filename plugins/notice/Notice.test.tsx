/** @jsxImportSource hono/jsx */
import { assertEquals, assertStringIncludes } from "@std/assert";
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

Deno.test("Notice draws the bubble outlined — white fill, hairline black border", () => {
  const html = render({
    notices: [{
      id: "n-abc123",
      text: "Bread is in the oven",
      imageDataUrl: null,
      timeLabel: "08:12",
    }],
    earlierCount: 0,
  });

  assertStringIncludes(html, "background: #fff");
  assertStringIncludes(html, "border: 3px solid #000");
});

Deno.test("Notice never fills a surface dark (ADR-0011)", () => {
  const html = render({
    notices: [{
      id: "n-abc123",
      text: "Bread is in the oven",
      imageDataUrl: null,
      timeLabel: "08:12",
    }],
    earlierCount: 0,
  });

  // Any `background: #0..` rule would be a solid-dark region held for the
  // life of the notice — the shape ADR-0011 removed from Transport.
  assertEquals(html.includes("background: #0"), false);
});

Deno.test("Notice squares off the bubble's bottom-left corner", () => {
  const html = render({
    notices: [{
      id: "n-abc123",
      text: "Bread is in the oven",
      imageDataUrl: null,
      timeLabel: "08:12",
    }],
    earlierCount: 0,
  });

  assertStringIncludes(html, "border-radius: 0.5em 0.5em 0.5em 0");
});

Deno.test("Notice bottom-anchors the thread and left-aligns bubbles at 78% max width", () => {
  const html = render({
    notices: [{
      id: "n-abc123",
      text: "Bread is in the oven",
      imageDataUrl: null,
      timeLabel: "08:12",
    }],
    earlierCount: 0,
  });

  assertStringIncludes(html, "justify-content: flex-end");
  assertStringIncludes(html, "align-items: flex-start");
  assertStringIncludes(html, "max-width: 78%");
});

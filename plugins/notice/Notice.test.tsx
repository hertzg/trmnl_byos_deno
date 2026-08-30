/** @jsxImportSource hono/jsx */
import { assertEquals, assertLess, assertStringIncludes } from "@std/assert";
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

Deno.test("Notice labels each bubble with its time in small grey monospace", () => {
  const html = render({
    notices: [{
      id: "n-abc123",
      text: "Bread is in the oven",
      imageDataUrl: null,
      timeLabel: "08:12",
    }],
    earlierCount: 0,
  });

  assertStringIncludes(html, ">08:12<");
  assertStringIncludes(html, "font-family: ui-monospace, monospace");
  assertStringIncludes(html, "color: #555");
});

Deno.test("Notice keeps the given order — oldest at the top, newest at the bottom", () => {
  const html = render({
    notices: [
      { id: "n-older", text: "Sent first", imageDataUrl: null, timeLabel: "08:12" },
      { id: "n-newer", text: "Sent second", imageDataUrl: null, timeLabel: "09:40" },
    ],
    earlierCount: 0,
  });

  assertLess(html.indexOf("Sent first"), html.indexOf("Sent second"));
});

Deno.test("Notice rolls older notices up into one centred line above the thread", () => {
  const html = render({
    notices: [{
      id: "n-abc123",
      text: "Bread is in the oven",
      imageDataUrl: null,
      timeLabel: "08:12",
    }],
    earlierCount: 3,
  });

  assertStringIncludes(html, "3 earlier");
  assertLess(html.indexOf("3 earlier"), html.indexOf("Bread is in the oven"));
});

Deno.test("Notice renders no roll-up line when earlierCount is 0", () => {
  const html = render({
    notices: [{
      id: "n-abc123",
      text: "Bread is in the oven",
      imageDataUrl: null,
      timeLabel: "08:12",
    }],
    earlierCount: 0,
  });

  assertEquals(html.includes('class="earlier"'), false);
});

Deno.test("Notice fills the screen with a single notice", () => {
  const html = render({
    notices: [{ id: "n-one", text: "Only one", imageDataUrl: null, timeLabel: "08:12" }],
    earlierCount: 0,
  });

  assertStringIncludes(html, 'class="thread scale-one"');
  assertStringIncludes(html, ".scale-one { font-size: 7.4vw }");
});

Deno.test("Notice drops to medium type once notices share the screen", () => {
  const html = render({
    notices: [
      { id: "n-one", text: "First", imageDataUrl: null, timeLabel: "08:12" },
      { id: "n-two", text: "Second", imageDataUrl: null, timeLabel: "09:40" },
      { id: "n-three", text: "Third", imageDataUrl: null, timeLabel: "11:05" },
    ],
    earlierCount: 0,
  });

  assertStringIncludes(html, 'class="thread scale-few"');
  assertStringIncludes(html, ".scale-few { font-size: 4.6vw }");
});

Deno.test("Notice drops to small type at four notices and up", () => {
  const html = render({
    notices: [
      { id: "n-one", text: "First", imageDataUrl: null, timeLabel: "08:12" },
      { id: "n-two", text: "Second", imageDataUrl: null, timeLabel: "09:40" },
      { id: "n-three", text: "Third", imageDataUrl: null, timeLabel: "11:05" },
      { id: "n-four", text: "Fourth", imageDataUrl: null, timeLabel: "13:30" },
    ],
    earlierCount: 0,
  });

  assertStringIncludes(html, 'class="thread scale-many"');
  assertStringIncludes(html, ".scale-many { font-size: 3.3vw }");
});

Deno.test("Notice renders a photo inside the bubble with the text below as a caption", () => {
  const html = render({
    notices: [{
      id: "n-abc123",
      text: "Look what the cat did",
      imageDataUrl: "data:image/jpeg;base64,AAAA",
      timeLabel: "08:12",
    }],
    earlierCount: 0,
  });

  assertStringIncludes(html, '<img class="photo" src="data:image/jpeg;base64,AAAA"');
  assertStringIncludes(html, "width: 46vw");
  assertStringIncludes(html, "aspect-ratio: 4 / 3");
  assertLess(html.indexOf("<img"), html.indexOf("Look what the cat did"));
});

Deno.test("Notice renders no img when the notice has no photo", () => {
  const html = render({
    notices: [{
      id: "n-abc123",
      text: "Bread is in the oven",
      imageDataUrl: null,
      timeLabel: "08:12",
    }],
    earlierCount: 0,
  });

  assertEquals(html.includes("<img"), false);
});

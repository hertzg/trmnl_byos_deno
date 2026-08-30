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
});

Deno.test("Notice caps the bubble width on the message wrapper, not the bubble", () => {
  const html = render({
    notices: [{
      id: "n-abc123",
      text: "Bread is in the oven",
      imageDataUrl: null,
      timeLabel: "08:12",
    }],
    earlierCount: 0,
  });

  // A spelling guard on which element carries the cap, not a layout check --
  // renderToString resolves no percentages, so the visual pass owns whether
  // 78% is the right number. The element is the part that was wrong: on
  // `.bubble` the percentage resolved against a shrink-to-fit box and did
  // nothing at all, and an assertion on the bare string passed either way.
  const start = html.indexOf(".msg {");
  const msgRule = html.slice(start, html.indexOf("}", start));

  assertStringIncludes(msgRule, "max-width: 78%");
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
  assertStringIncludes(html, "min(46vw");
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

Deno.test("Notice escapes the notice text — it arrives from an HTTP POST", () => {
  const html = render({
    notices: [{
      id: "n-abc123",
      text: "<script>alert(1)</script> & co",
      imageDataUrl: null,
      timeLabel: "08:12",
    }],
    earlierCount: 0,
  });

  assertEquals(html.includes("<script>"), false);
  assertStringIncludes(html, "&lt;script&gt;alert(1)&lt;/script&gt; &amp; co");
});

Deno.test("Notice sizes the photo from the notice count and the photo count", () => {
  const html = render({
    notices: [
      { id: "n-one", text: "First", imageDataUrl: null, timeLabel: "08:12" },
      { id: "n-two", text: "Second", imageDataUrl: null, timeLabel: "09:40" },
      {
        id: "n-three",
        text: "Third",
        imageDataUrl: "data:image/jpeg;base64,AAAA",
        timeLabel: "11:05",
      },
      { id: "n-four", text: "Fourth", imageDataUrl: null, timeLabel: "13:30" },
      { id: "n-five", text: "Fifth", imageDataUrl: null, timeLabel: "17:03" },
    ],
    earlierCount: 0,
  });

  // Every message is charged for its own text and time label; only the
  // messages carrying a photo split what is left. A photo pinned to the panel
  // regardless of count pushes the oldest messages off the top edge, where
  // the panel has no scrollbar and shows no clipping indicator.
  assertStringIncludes(html, "--rows:5;--photos:1");
});

Deno.test("Notice charges one photo notice for one row and one photo", () => {
  const html = render({
    notices: [{
      id: "n-abc123",
      text: "Look what the cat did",
      imageDataUrl: "data:image/jpeg;base64,AAAA",
      timeLabel: "08:12",
    }],
    earlierCount: 0,
  });

  assertStringIncludes(html, "--rows:1;--photos:1");
});

Deno.test("Notice keeps the roll-up line out of the region that clips", () => {
  const html = render({
    notices: [
      { id: "n-one", text: "First", imageDataUrl: null, timeLabel: "08:12" },
      { id: "n-two", text: "Second", imageDataUrl: null, timeLabel: "09:40" },
    ],
    earlierCount: 4,
  });

  // Overflow leaves `.messages` by the start edge, so the first child is the
  // first thing lost. The line announcing hidden notices must not sit there.
  assertLess(html.indexOf('class="earlier"'), html.indexOf('class="messages"'));
});

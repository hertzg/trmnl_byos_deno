/** @jsxImportSource hono/jsx */
import { assertEquals, assertNotEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { createRenderer } from "./renderer.ts";

Deno.test("ensureFrame: rasterizes the frame and stores PNG bytes keyed by jobId", async () => {
  const renderer = createRenderer({
    onDisplay: () => Promise.resolve({ jsx: <div>hi</div>, validForSeconds: 60 }),
    rasterize: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    origin: "http://localhost",
  });

  const frame = await renderer.ensureFrame();

  assertEquals(renderer.getJobPng(frame.jobId), new Uint8Array([1, 2, 3]));
});

Deno.test("ensureFrame: concurrent calls coalesce into a single onDisplay invocation", async () => {
  let onDisplayCalls = 0;
  let releaseOnDisplay: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseOnDisplay = resolve;
  });

  const renderer = createRenderer({
    onDisplay: async () => {
      onDisplayCalls++;
      await gate;
      return { jsx: <div>hi</div>, validForSeconds: 60 };
    },
    rasterize: () => Promise.resolve(new Uint8Array([1])),
    origin: "http://localhost",
  });

  const aPromise = renderer.ensureFrame();
  const bPromise = renderer.ensureFrame();
  releaseOnDisplay!();

  const [a, b] = await Promise.all([aPromise, bPromise]);

  assertEquals(a.jobId, b.jobId);
  assertEquals(onDisplayCalls, 1);
});

Deno.test("ensureFrame: triggers a fresh render after validity expires", async () => {
  let now = new Date("2026-01-01T00:00:00Z");
  let onDisplayCalls = 0;
  const renderer = createRenderer({
    onDisplay: () => {
      onDisplayCalls++;
      return Promise.resolve({ jsx: <div>hi</div>, validForSeconds: 60 });
    },
    rasterize: () => Promise.resolve(new Uint8Array([1])),
    origin: "http://localhost",
    now: () => now,
  });

  const a = await renderer.ensureFrame();
  now = new Date(now.getTime() + 61_000);
  const b = await renderer.ensureFrame();

  assertNotEquals(a.jobId, b.jobId);
  assertEquals(onDisplayCalls, 2);
});

Deno.test("getJobHtml: returns the rendered HTML for an active job", async () => {
  const renderer = createRenderer({
    onDisplay: () => Promise.resolve({ jsx: <div>hello world</div>, validForSeconds: 60 }),
    rasterize: () => Promise.resolve(new Uint8Array([1])),
    origin: "http://localhost",
  });

  const frame = await renderer.ensureFrame();
  const html = renderer.getJobHtml(frame.jobId);

  assertStringIncludes(html ?? "", "hello world");
});

Deno.test("ensureFrame: when onDisplay throws, caches an error frame rendered from errorJsx", async () => {
  const renderer = createRenderer({
    onDisplay: () => {
      throw new Error("boom");
    },
    rasterize: () => Promise.resolve(new Uint8Array([0xff])),
    errorJsx: (err: Error) => <div>error: {err.message}</div>,
    errorValiditySeconds: 30,
    origin: "http://localhost",
  });

  const frame = await renderer.ensureFrame();
  const html = renderer.getJobHtml(frame.jobId);

  assertStringIncludes(html ?? "", "error: boom");
});

Deno.test("ensureFrame: when rasterize fails on the real frame, falls back to the error frame", async () => {
  let rasterizeCalls = 0;
  const renderer = createRenderer({
    onDisplay: () => Promise.resolve({ jsx: <div>real</div>, validForSeconds: 60 }),
    rasterize: () => {
      rasterizeCalls++;
      if (rasterizeCalls === 1) return Promise.reject(new Error("rasterize-boom"));
      return Promise.resolve(new Uint8Array([0xff]));
    },
    errorJsx: (err: Error) => <div>err: {err.message}</div>,
    origin: "http://localhost",
  });

  const frame = await renderer.ensureFrame();
  const html = renderer.getJobHtml(frame.jobId);

  assertStringIncludes(html ?? "", "err: rasterize-boom");
  assertEquals(rasterizeCalls, 2);
});

Deno.test("ensureFrame: propagates when rasterize fails on both real and error frames", async () => {
  const renderer = createRenderer({
    onDisplay: () => Promise.resolve({ jsx: <div>real</div>, validForSeconds: 60 }),
    rasterize: () => Promise.reject(new Error("always-broken")),
    errorJsx: () => <div>err</div>,
    origin: "http://localhost",
  });

  await assertRejects(() => renderer.ensureFrame(), Error, "always-broken");
});

Deno.test("previewHtml: renders the onDisplay JSX to HTML without invoking rasterize", async () => {
  let rasterizeCalls = 0;
  const renderer = createRenderer({
    onDisplay: () => Promise.resolve({ jsx: <div>preview body</div>, validForSeconds: 60 }),
    rasterize: () => {
      rasterizeCalls++;
      return Promise.resolve(new Uint8Array([0xff]));
    },
    origin: "http://localhost",
  });

  const html = await renderer.previewHtml();

  assertStringIncludes(html, "preview body");
  assertEquals(rasterizeCalls, 0);
});

Deno.test("previewHtml: does not affect the canonical current frame", async () => {
  const renderer = createRenderer({
    onDisplay: () => Promise.resolve({ jsx: <div>frame</div>, validForSeconds: 60 }),
    rasterize: () => Promise.resolve(new Uint8Array([0xab])),
    origin: "http://localhost",
  });

  const original = await renderer.ensureFrame();
  await renderer.previewHtml();
  const again = await renderer.ensureFrame();

  assertEquals(again.jobId, original.jobId);
});

Deno.test("renderEphemeral: returns PNG bytes and stores them under a fresh jobId without touching current frame", async () => {
  const renderer = createRenderer({
    onDisplay: () => Promise.resolve({ jsx: <div>frame</div>, validForSeconds: 60 }),
    rasterize: () => Promise.resolve(new Uint8Array([0xab])),
    origin: "http://localhost",
  });

  const original = await renderer.ensureFrame();
  const ephemeral = await renderer.renderEphemeral(<div>preview</div>);

  assertEquals(ephemeral.png, new Uint8Array([0xab]));
  assertNotEquals(ephemeral.jobId, original.jobId);
  assertEquals(renderer.getJobPng(ephemeral.jobId), new Uint8Array([0xab]));

  const again = await renderer.ensureFrame();
  assertEquals(again.jobId, original.jobId);
});

Deno.test("ensureFrame: returns cached frame within validity without re-invoking onDisplay", async () => {
  let onDisplayCalls = 0;
  const renderer = createRenderer({
    onDisplay: () => {
      onDisplayCalls++;
      return Promise.resolve({ jsx: <div>hi</div>, validForSeconds: 60 });
    },
    rasterize: () => Promise.resolve(new Uint8Array([1])),
    origin: "http://localhost",
  });

  const a = await renderer.ensureFrame();
  const b = await renderer.ensureFrame();

  assertEquals(a.jobId, b.jobId);
  assertEquals(onDisplayCalls, 1);
});

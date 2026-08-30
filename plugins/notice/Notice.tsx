/** @jsxImportSource hono/jsx */

// Only what the HTML renders: the bubbles, already formatted. Identical state
// produces identical HTML and therefore identical identity (ADR-0004).
export type NoticeState = {
  notices: Array<{
    id: string;
    text: string;
    imageDataUrl: string | null;
    timeLabel: string;
  }>;
  earlierCount: number;
};

// Inlined rather than shipped as an asset: `SystemConfig.pluginAssetsDir`
// points at exactly one directory, so a `plugins/notice/assets/` folder would
// never reach the Renderer (ADR-0008, ADR-0009).
const css = `
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  background: #fff;
  color: #000;
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-weight: 500;
  line-height: 1.25;
}

.thread {
  box-sizing: border-box;
  height: 100%;
  padding: 2.4vw 3vw;
  display: flex;
  flex-direction: column;
  /* Newest sits at the bottom, where the eye expects it. */
  justify-content: flex-end;
  align-items: flex-start;
  gap: 0.5em;
}

.bubble {
  box-sizing: border-box;
  max-width: 78%;
  padding: 0.34em 0.5em;
  /* Outlined, never filled: a filled bubble is a large solid-dark surface
     held for the life of the notice (ADR-0011). */
  background: #fff;
  border: 3px solid #000;
  /* Square bottom-left reads as a chat bubble without needing a tail. */
  border-radius: 0.5em 0.5em 0.5em 0;
}

.earlier {
  align-self: center;
  margin-bottom: 0.2em;
  font-family: ui-monospace, monospace;
  font-size: 0.34em;
  color: #555;
}

.time {
  margin: 0.1em 0 0 0.5em;
  font-family: ui-monospace, monospace;
  font-size: 0.34em;
  color: #555;
}
`;

export default function Notice({ notices, earlierCount }: NoticeState) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <title>notice</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <div class="thread">
          {earlierCount > 0 && <div class="earlier">{earlierCount} earlier</div>}
          {notices.map((notice) => (
            <div class="msg" key={notice.id}>
              <div class="bubble">{notice.text}</div>
              <div class="time">{notice.timeLabel}</div>
            </div>
          ))}
        </div>
      </body>
    </html>
  );
}

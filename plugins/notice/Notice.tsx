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
}

/* The roll-up line sits outside this box on purpose: anything that overflows
   here leaves by the *start* edge, which the panel cannot show and nothing
   indicates, so the one element announcing hidden notices must not be the
   first thing clipped. */
.messages {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* Newest sits at the bottom, where the eye expects it. */
  justify-content: flex-end;
  align-items: flex-start;
  gap: 0.5em;
  overflow: hidden;
}

/* One notice fills the screen; a few share it; four or more go small. Every
   size below is an em of the thread's font size, so one number moves the
   whole view. */
.scale-one { font-size: 7.4vw }
.scale-few { font-size: 4.6vw }
.scale-many { font-size: 3.3vw }

/* Caps the bubble's width against a definite width (the thread's content
   box) while letting the bubble itself hug its text. */
.msg {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  max-width: 78%;
}

.bubble {
  box-sizing: border-box;
  padding: 0.34em 0.5em;
  /* Outlined, never filled: a filled bubble is a large solid-dark surface
     held for the life of the notice (ADR-0011). */
  background: #fff;
  border: 3px solid #000;
  /* Square bottom-left reads as a chat bubble without needing a tail. */
  border-radius: 0.5em 0.5em 0.5em 0;
}

/* The one place gray is spent: photographic content, which needs tone
   (ADR-0011). A 4:3 slot 46% of the panel wide when there is room for it, and
   narrower when there is not. Every message pays for its own text line,
   padding, time label and gap first (3.1em each, measured against a rendered
   bubble at 2.49em plus the 0.5em gap); the photos then split whatever height
   the panel has left. Both counts come straight off the state: --rows is how
   many messages are on screen, --photos how many of them carry an image, so a
   lone photo among five notices is not charged for the other four. A photo
   sized off the panel alone is the one thing in this sheet that does not
   yield as the thread fills, and two of them push the oldest messages -- and
   the roll-up line announcing them -- off the top edge. */
.photo {
  display: block;
  width: min(46vw, calc((88vh - var(--rows) * 3.1em) / var(--photos) * 4 / 3));
  aspect-ratio: 4 / 3;
  object-fit: cover;
  margin-bottom: 0.2em;
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

function scaleFor(count: number) {
  if (count <= 1) return "scale-one";
  if (count <= 3) return "scale-few";
  return "scale-many";
}

export default function Notice({ notices, earlierCount }: NoticeState) {
  const photoCount = notices.filter((notice) => notice.imageDataUrl !== null).length;

  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <title>notice</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <div
          class={`thread ${scaleFor(notices.length)}`}
          style={`--rows:${Math.max(1, notices.length)};--photos:${Math.max(1, photoCount)}`}
        >
          {earlierCount > 0 && <div class="earlier">{earlierCount} earlier</div>}
          <div class="messages">
            {notices.map((notice) => (
              <div class="msg" key={notice.id}>
                <div class="bubble">
                  {notice.imageDataUrl !== null && <img class="photo" src={notice.imageDataUrl} />}
                  <div>{notice.text}</div>
                </div>
                <div class="time">{notice.timeLabel}</div>
              </div>
            ))}
          </div>
        </div>
      </body>
    </html>
  );
}

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

/* One notice fills the screen; a few share it; four or more go small. Every
   size below is an em of the thread's font size, so one number moves the
   whole view. */
.scale-one { font-size: 7.4vw }
.scale-few { font-size: 4.6vw }
.scale-many { font-size: 3.3vw }

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
   (ADR-0011). */
.photo {
  display: block;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  margin-bottom: 0.2em;
}

/* The newest photo is the one worth looking at, so it gets the room the thread
   has left: 93.6vh is the thread's content box (the panel less its 2.4vw
   padding, top and bottom) and every row is charged 4.25em of it first -- the
   measured pitch of a two-line bubble, its padding, border, time label and gap
   included. A message is a row, and an older photo is charged a row of its own
   for the thumbnail it adds. Text wins over the photo, never the other way
   round. Both numbers are empirical, and the vw padding only reconciles with
   the vh budget at this panel's one aspect ratio; it holds because it is
   conservative, not because it is derived. Below the thumbnail size the photo
   stops shrinking -- a one-pixel sliver says less than a small picture. */
.photo-newest {
  width: max(3em, min(46vw, calc(max(0px, 93.6vh - var(--rows) * 4.25em) * 4 / 3)));
}

/* An older photo is a reminder that a photo is there, not the photo itself.
   One number, an em of the type scale, so it moves with the notice count. */
.photo-old {
  width: 3em;
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
  const withPhoto = notices.filter((notice) => notice.imageDataUrl !== null);
  const newestPhotoId = withPhoto.length > 0 ? withPhoto[withPhoto.length - 1].id : null;
  const rows = notices.length + Math.max(0, withPhoto.length - 1);

  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <title>notice</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <div class={`thread ${scaleFor(notices.length)}`} style={`--rows:${rows}`}>
          {earlierCount > 0 && <div class="earlier">{earlierCount} earlier</div>}
          <div class="messages">
            {notices.map((notice) => (
              <div class="msg" key={notice.id}>
                <div class="bubble">
                  {notice.imageDataUrl !== null && (
                    <img
                      class={notice.id === newestPhotoId ? "photo photo-newest" : "photo photo-old"}
                      src={notice.imageDataUrl}
                    />
                  )}
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

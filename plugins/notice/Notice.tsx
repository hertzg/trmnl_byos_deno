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

export default function Notice({ notices }: NoticeState) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <title>notice</title>
      </head>
      <body>
        <div class="thread">
          {notices.map((notice) => (
            <div class="msg" key={notice.id}>
              <div class="bubble">{notice.text}</div>
            </div>
          ))}
        </div>
      </body>
    </html>
  );
}

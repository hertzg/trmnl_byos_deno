/** @jsxImportSource hono/jsx */

// View used by the Conductor's error fallback path (ADR-0003). When
// Plugin.run / deriveHtml / rasterize throws, the Conductor wraps the
// Error in a Result whose `view` is this component and whose `validity`
// is the Conductor's configured `errorValidity` (~30 s).

const css = `
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    padding: 24px;
    box-sizing: border-box;
    font-family: -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
  }
  .banner {
    border: 3px solid #000;
    padding: 12px 16px;
    margin-bottom: 16px;
    font-size: 28px;
    font-weight: 700;
  }
  .msg {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 16px;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }
`;

export default function ErrorView(err: Error) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Plugin error</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <div class="banner">Plugin error</div>
        <div class="msg">{err.message}</div>
      </body>
    </html>
  );
}

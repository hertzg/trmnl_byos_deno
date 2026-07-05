/** @jsxImportSource hono/jsx */

// Conductor's error fallback view. See ADR-0003.

import css from "./error-view.css" with { type: "text" };

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

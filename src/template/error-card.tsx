/** @jsxImportSource hono/jsx */

import type { DisplayKind } from "./run.ts";

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
  .stack {
    margin-top: 16px;
    padding: 12px;
    border: 1px solid #000;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 11px;
    line-height: 1.3;
    white-space: pre-wrap;
    word-break: break-word;
  }
`;

export type ErrorCardProps = {
  kind: DisplayKind;
  message: string;
  stack?: string;
};

export default function ErrorCard(props: ErrorCardProps) {
  const { kind, message, stack } = props;
  const showStack = kind === "preview" && stack;
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Template error</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <div class="banner">Template error</div>
        <div class="msg">{message}</div>
        {showStack ? <div class="stack">{stack}</div> : null}
      </body>
    </html>
  );
}

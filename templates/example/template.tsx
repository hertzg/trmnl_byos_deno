/** @jsxImportSource hono/jsx */

export type DefaultProps = {
  time: string;
  hostname: string;
  panel: string;
};

export default function DefaultTemplate(props: DefaultProps) {
  const { time, hostname, panel } = props;
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <title>trmnl-byos-deno</title>
        <link rel="stylesheet" href="/assets/style.css" />
      </head>
      <body>
        <div class="banner">
          <h1>trmnl-byos-deno</h1>
        </div>
        <div class="meta">
          <div>
            <b>host:</b> {hostname}
          </div>
          <div>
            <b>panel:</b> {panel}
          </div>
          <div>
            <b>time:</b> {time}
          </div>
        </div>
      </body>
    </html>
  );
}

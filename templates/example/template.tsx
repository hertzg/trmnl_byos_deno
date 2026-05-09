/** @jsxImportSource hono/jsx */

export type DefaultProps = {
  time: string;
  hostname: string;
  deviceId: string;
};

export default function DefaultTemplate(props: DefaultProps) {
  const { time, hostname, deviceId } = props;
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
            <b>device:</b> {deviceId}
          </div>
          <div>
            <b>time:</b> {time}
          </div>
        </div>
      </body>
    </html>
  );
}

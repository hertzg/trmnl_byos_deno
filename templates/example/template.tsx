/** @jsxImportSource hono/jsx */

export type HNStory = {
  id: number;
  title: string;
  score: number;
  by: string;
  descendants?: number;
  url?: string;
  time: number;
};

export type DefaultProps = {
  topStories: HNStory[];
};

export default function DefaultTemplate(props: DefaultProps) {
  const { topStories } = props;

  return (
    <html class="trmnl">
      <head>
        <meta charset="utf-8" />
        <title>trmnl-byos-deno</title>
        <link
          rel="stylesheet"
          href="https://trmnl.com/css/latest/plugins.css"
        />
        <link rel="stylesheet" href="/assets/style.css" />
      </head>
      <body class="environment trmnl">
        <div class="screen screen--v2 screen--4bit screen--landscape screen--lg">
          <div class="view view--full">
            <div class="layout layout--col gap--space-between">
              <div class="columns gap--small" data-overflow-cols="3">
                <div class="column">
                  {topStories.map((s) => (
                    <div class="item">
                      <div class="meta">
                        <span class="index"></span>
                      </div>
                      <div class="content">
                        <span class="title title--small">{s.title}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div class="title_bar">
              <span class="title">trmnl-byos-deno</span>
              <span class="instance">demo template</span>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}

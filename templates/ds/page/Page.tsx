/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";
import { Styles } from "../styles/Styles.tsx";

export type PageProps = {
  title: string;
  stylesheet?: string;
  lang?: string;
  children?: Child;
};

export function Page({ title, stylesheet, lang, children }: PageProps) {
  return (
    <html lang={lang}>
      <head>
        <meta charset="utf-8" />
        <title>{title}</title>
        {
          /* <Styles /> precedes the plugin stylesheet so plugin overrides win
            by source order (ADR-0008 §Customization API). */
        }
        <Styles />
        {stylesheet && <link rel="stylesheet" href={stylesheet} />}
      </head>
      <body>{children}</body>
    </html>
  );
}

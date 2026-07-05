/** @jsxImportSource hono/jsx */
import baseCss from "./base.css" with { type: "text" };
import chromeCss from "../chrome/chrome.css" with { type: "text" };
import layoutCss from "../layout/Layout.css" with { type: "text" };
import typographyCss from "../typography/typography.css" with { type: "text" };
import itemCss from "../item/Item.css" with { type: "text" };

// Future components add their CSS to this array.
const css = [
  baseCss,
  chromeCss,
  layoutCss,
  typographyCss,
  itemCss,
].join("\n");

export function Styles() {
  // hono/jsx escapes text children inside <style> (e.g. `a[data-x="y"] > b` becomes
  // `a[data-x=&quot;y&quot;] &gt; b`); CSS files are build-time author-controlled (not user
  // input), so injecting verbatim via dangerouslySetInnerHTML is safe and required.
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

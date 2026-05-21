/** @jsxImportSource hono/jsx */
import baseCss from "./base.css" with { type: "text" };
import chromeCss from "./chrome.css" with { type: "text" };

// Future components add their CSS to this array.
const css = [
  baseCss,
  chromeCss,
].join("\n");

export function Styles() {
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

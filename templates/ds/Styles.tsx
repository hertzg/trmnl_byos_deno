/** @jsxImportSource hono/jsx */
import baseCss from "./base.css" with { type: "text" };

// Future components add their CSS to this array.
const css = [
  baseCss,
].join("\n");

export function Styles() {
  return <style>{css}</style>;
}

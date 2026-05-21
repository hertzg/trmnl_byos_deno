/** @jsxImportSource hono/jsx */
import baseCss from "./base.css" with { type: "text" };

// Future components append their CSS to this string.
const css = baseCss;

export function Styles() {
  return <style>{css}</style>;
}

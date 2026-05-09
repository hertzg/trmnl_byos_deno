/** @jsxImportSource hono/jsx */

// One line's identity: short route badge ("U5", "S7", "M4") followed by its destination.
// Long destinations get truncated by the CSS ellipsis on `.line-label__direction`.
export default function LineLabel(
  { line, direction }: { line: string; direction: string },
) {
  return (
    <div class="line-label">
      <span class="line-label__badge">{line}</span>
      <span class="line-label__direction">{direction}</span>
    </div>
  );
}

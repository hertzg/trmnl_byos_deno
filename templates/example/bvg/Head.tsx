/** @jsxImportSource hono/jsx */

// Section header used by all three layouts: bold title row + optional subtitle line.
// `stamp` carries the "as of HH:MM" freshness indicator — absolute time, since the
// e-ink frame doesn't refresh often enough for relative ("X min ago") to stay honest.

export default function Head(
  { title, sub, stamp }: { title: string; sub?: string; stamp?: string },
) {
  return (
    <div class="head">
      <div class="head__row">
        <div class="head__title">{title}</div>
        {stamp && <div class="head__stamp">{stamp}</div>}
      </div>
      {sub && <div class="head__sub">{sub}</div>}
    </div>
  );
}

/** @jsxImportSource hono/jsx */

// A thin "this preference's journey is cancelled" strip. Replaces a full `Row`
// when the classifier emitted a `CancellationStrip` for the candidate. Renders
// only the preference's icon and a strikethrough caption — no pictogram, no
// times, no alert pills. Runs of consecutive same-icon strips are collapsed
// into one entry by the assembler, which sums the count; the caption pluralises
// to `"<icon> · N journeys cancelled"` when `count > 1`.

import type { CancellationStrip } from "./journey_classifier.ts";

export default function CancelStrip({ strip }: { strip: CancellationStrip }) {
  const text = strip.count > 1
    ? `${strip.preferenceIcon} · გაუქმდა ${strip.count} მგზავრობა`
    : `${strip.preferenceIcon} · გაუქმდა`;
  return (
    <div class="cancel-strip">
      <span class="cancel-strip__icon">{strip.preferenceIcon}</span>
      <span class="cancel-strip__text">{text}</span>
    </div>
  );
}

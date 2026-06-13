/** @jsxImportSource hono/jsx */
import { Content, Layout, Page } from "@ds";
import type { Board } from "./bvg/board_assembler.ts";
import BoardView from "./bvg/Board.tsx";

// The view's input. Slim by design — only the fields rendered into HTML live
// here, so identical state → identical HTML → identical filename → Device
// skips the e-ink refresh (ADR-0004). The board carries its own row-level
// timestamps; the view is now chrome-free (ADR-0011), so the board is all it
// needs.
export type FrameData = {
  board: Board;
};

export default function DefaultTemplate({ board }: FrameData) {
  // Chrome-free by ADR-0011: on the TRMNL X panel, value-stable dark pixels
  // held for hours ghost into the next screen. The departure rows are the
  // only persistent ink; everything else (title, date, instance label,
  // battery) was dropped so nothing static burns in.
  return (
    <Page title="trmnl-byos-deno" stylesheet="/assets/style.css">
      <Layout>
        <Content>
          <BoardView board={board} />
        </Content>
      </Layout>
    </Page>
  );
}

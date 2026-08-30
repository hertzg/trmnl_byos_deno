/** @jsxImportSource hono/jsx */
import { Content, Layout, Page } from "@hztrmnl/ds";
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
  // Deliberately chrome-free: departure rows only, no title, date, instance
  // label or battery. This started as a ghosting mitigation, which ADR-0011
  // now records as unfounded — the panel has no content-driven ghost cost.
  // What's left is a layout choice, open to revisiting.
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

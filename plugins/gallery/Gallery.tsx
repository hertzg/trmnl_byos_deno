/** @jsxImportSource hono/jsx */
import { EmptyState, Page } from "@hztrmnl/ds";

// Only what the HTML renders: the signed CDN URL for the photo currently up,
// or null with a reason when there is nothing to show (empty album, or the
// album fetch failed).
export type GalleryState = {
  src: string | null;
  // Shown in the empty state so a dead album API is diagnosable from the
  // dashboard rather than silently blank.
  note?: string;
};

export default function Gallery({ src, note }: GalleryState) {
  if (src !== null) {
    // Edge-to-edge, center-cropped to fill (`object-fit: cover`, default
    // 50/50 object-position). Deliberate: album photos are curated to keep
    // the subject centered (and preferably landscape), which beats doing
    // saliency math server-side for a single-user gallery.
    return (
      <html>
        <head>
          <meta charset="utf-8" />
          <title>gallery</title>
          <style
            dangerouslySetInnerHTML={{
              __html:
                "html,body{margin:0;padding:0;width:100%;height:100%;background:#fff}img{display:block;width:100%;height:100%;object-fit:cover}",
            }}
          />
        </head>
        <body>
          <img src={src} />
        </body>
      </html>
    );
  }

  return (
    <Page title="gallery">
      <EmptyState big="No photo" sub={note ?? "The shared album is empty"} />
    </Page>
  );
}

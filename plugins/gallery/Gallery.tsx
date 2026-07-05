/** @jsxImportSource hono/jsx */
import { EmptyState, Page } from "@hztrmnl/ds";

// Co-located with the view that owns the concept. Only the fields rendered
// into HTML live here — nothing the rotation logic cares about, nothing the
// Plugin state machine cares about beyond passing it through to the view.
export type GalleryState = {
  // The chosen `/assets/gallery/…` URL, or null when the gallery is empty.
  src: string | null;
};

export default function Gallery({ src }: GalleryState) {
  if (src !== null) {
    // Edge-to-edge, no chrome. The inline style is plugin-author-written bytes
    // (satisfies the "no implicit HTML injection" rule) — no separate CSS asset
    // is needed for a three-rule reset.
    return (
      <html>
        <head>
          <meta charset="utf-8" />
          <title>gallery</title>
          <style
            dangerouslySetInnerHTML={{
              __html:
                "html,body{margin:0;padding:0;width:100%;height:100%}img{display:block;width:100%;height:100%;object-fit:cover}",
            }}
          />
        </head>
        <body>
          <img src={src} />
        </body>
      </html>
    );
  }

  // No photos yet. Tell the reader where to drop them.
  return (
    <Page title="gallery">
      <EmptyState
        big="No photos"
        sub="Add images to config/live/plugins/gallery/images/"
      />
    </Page>
  );
}

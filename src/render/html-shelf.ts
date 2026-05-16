// A short-lived in-memory map from a generated id to the HTML that the
// Renderer's CDP sidecar will fetch back when it visits
// `${origin}/preview/${id}`. The Renderer's `rasterize` shelves before
// asking CDP for a screenshot and removes once the PNG is in hand.

export type HtmlShelf = {
  shelve(html: string): string;
  fetch(id: string): string | undefined;
  remove(id: string): void;
};

export function createHtmlShelf(): HtmlShelf {
  const store = new Map<string, string>();
  return {
    shelve(html) {
      const id = crypto.randomUUID();
      store.set(id, html);
      return id;
    },
    fetch(id) {
      return store.get(id);
    },
    remove(id) {
      store.delete(id);
    },
  };
}

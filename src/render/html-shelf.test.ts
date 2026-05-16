import { assertEquals, assertNotEquals } from "@std/assert";
import { createHtmlShelf } from "./html-shelf.ts";

Deno.test("html shelf round-trips html keyed by generated ids; remove evicts", () => {
  const shelf = createHtmlShelf();

  const id = shelf.shelve("<p>hi</p>");
  const other = shelf.shelve("<p>other</p>");

  assertEquals(shelf.fetch(id), "<p>hi</p>");
  assertEquals(shelf.fetch(other), "<p>other</p>");
  assertNotEquals(id, other);

  shelf.remove(id);
  assertEquals(shelf.fetch(id), undefined);
  assertEquals(shelf.fetch(other), "<p>other</p>");
});

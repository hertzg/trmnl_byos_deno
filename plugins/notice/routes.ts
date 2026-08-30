import { Hono } from "hono";
import { appPage } from "./app-page.ts";
import { DEFAULT_MINUTES, type NoticeImage } from "./inbox.ts";
import { inbox } from "./state.ts";

// The ingress. Four routes over the one inbox, handed the two things they
// cannot know on their own — when the Device next polls, and how to drop the
// cached Image. A factory taking those as functions is what keeps this
// package from importing Server internals.

export type NoticeDeps = {
  /** When the Device is next expected to ask for an image. */
  nextPoll(): Temporal.Instant;
  /** Drop the cached Image so the next poll re-renders. */
  invalidate(): void;
};

const MAX_MINUTES = 1440;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

// multipart rather than JSON on purpose: it is what Shortcuts' Get Contents
// of URL produces without a fight, and it carries the photo in the same
// request as the text.
export default function createNoticeRoutes(deps: NoticeDeps): Hono {
  return new Hono()
    // The control page. A fifth route, but not a fifth endpoint: it serves
    // one static string and drives the four below from the phone. no-store
    // because this page lives on a Home Screen, where a copy cached across a
    // redeploy is exactly the annoying case.
    .get("/notice/app", (c) => c.html(appPage, 200, { "cache-control": "no-store" }))
    .post("/notice", async (c) => {
      const body = await c.req.formData();

      const text = readText(body.get("text"));
      if (text === null) return c.json({ error: "text is required" }, 400);

      const minutes = readMinutes(body.get("minutes"));
      if (minutes === null) {
        return c.json({ error: `minutes must be a whole number 1..${MAX_MINUTES}` }, 400);
      }

      const file = body.get("image");
      if (file instanceof File && file.size > MAX_IMAGE_BYTES) {
        return c.json({ error: "image is larger than 4 MB" }, 400);
      }
      const image = await readImage(file);

      // The lifetime starts at the next poll, not at arrival: one sent at
      // 23:30 while the panel sleeps gets its full hour from the 07:00
      // wake-up. Nothing else in the system needs to know sleep windows
      // exist.
      const showsAt = deps.nextPoll();
      const expiresAt = showsAt.add({ minutes });
      const notice = inbox.add({
        text,
        image,
        receivedAt: Temporal.Now.instant(),
        expiresAt,
      });
      deps.invalidate();

      return c.json({
        id: notice.id,
        showsAt: showsAt.toString(),
        expiresAt: expiresAt.toString(),
      });
    })
    // No image bytes: hasImage is enough to render a list, and the payload
    // stays small.
    .get("/notice", (c) =>
      c.json({
        notices: inbox.live(Temporal.Now.instant()).map((notice) => ({
          id: notice.id,
          text: notice.text,
          hasImage: notice.image !== null,
          receivedAt: notice.receivedAt.toString(),
          expiresAt: notice.expiresAt.toString(),
        })),
      }))
    .delete("/notice/:id", (c) => {
      const removed = inbox.remove(c.req.param("id"));
      deps.invalidate();
      return c.json({ removed });
    })
    .delete("/notice", (c) => {
      // Counts what a GET would have listed — expired entries linger in the
      // array until a restart, and reporting them would be reporting noise.
      const removed = inbox.live(Temporal.Now.instant()).length;
      inbox.clear();
      deps.invalidate();
      return c.json({ removed });
    });
}

/** `null` when the field is missing, not a string, or empty after trimming. */
function readText(field: FormDataEntryValue | null): string | null {
  if (typeof field !== "string") return null;
  const text = field.trim();
  return text === "" ? null : text;
}

/** The default when the field is absent, `null` when it is present and wrong. */
function readMinutes(field: FormDataEntryValue | null): number | null {
  if (field === null || field === "") return DEFAULT_MINUTES;
  if (typeof field !== "string") return null;
  const minutes = Number(field);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) return null;
  return minutes;
}

async function readImage(field: FormDataEntryValue | null): Promise<NoticeImage | undefined> {
  // Shortcuts sends an empty part when the photo slot is left blank.
  if (!(field instanceof File) || field.size === 0) return undefined;
  return { mime: field.type, bytes: new Uint8Array(await field.arrayBuffer()) };
}

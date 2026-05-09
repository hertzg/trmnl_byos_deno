import { LruCache } from "@std/cache/lru-cache";
import { renderToString } from "hono/jsx/dom/server";

export type Frame = { jsx: unknown; validForSeconds: number };
export type OnDisplayFn = () => Frame | Promise<Frame>;
export type RasterizeFn = (htmlUrl: string) => Promise<Uint8Array>;

export type CurrentFrame = { jobId: string; validUntil: Date };
type Job = { html: string; png?: Uint8Array };

export type Renderer = {
  ensureFrame(): Promise<CurrentFrame>;
  getJobHtml(jobId: string): string | undefined;
  getJobPng(jobId: string): Uint8Array | undefined;
  renderEphemeral(jsx: unknown): Promise<{ jobId: string; png: Uint8Array }>;
};

export type RendererDeps = {
  onDisplay: OnDisplayFn;
  rasterize: RasterizeFn;
  origin: string;
  errorJsx?: (err: Error) => unknown;
  errorValiditySeconds?: number;
  cacheCapacity?: number;
  now?: () => Date;
};

export function createRenderer(deps: RendererDeps): Renderer {
  const jobs = new LruCache<string, Job>(deps.cacheCapacity ?? 16);
  const now = deps.now ?? (() => new Date());
  let current: CurrentFrame | null = null;
  let inFlight: Promise<CurrentFrame> | null = null;

  function asError(err: unknown): Error {
    return err instanceof Error ? err : new Error(String(err));
  }

  function errorFrame(err: Error): Frame {
    return {
      jsx: deps.errorJsx!(err),
      validForSeconds: deps.errorValiditySeconds ?? 30,
    };
  }

  async function rasterizeJsx(jsx: unknown): Promise<{ jobId: string; png: Uint8Array }> {
    const jobId = crypto.randomUUID();
    const html = "<!DOCTYPE html>" +
      renderToString(jsx as Parameters<typeof renderToString>[0]);
    jobs.set(jobId, { html });
    const png = await deps.rasterize(`${deps.origin}/preview/${jobId}`);
    jobs.set(jobId, { html, png });
    return { jobId, png };
  }

  async function renderToFrame(frame: Frame): Promise<CurrentFrame> {
    const { jobId } = await rasterizeJsx(frame.jsx);
    return {
      jobId,
      validUntil: new Date(now().getTime() + frame.validForSeconds * 1000),
    };
  }

  async function startRender(): Promise<CurrentFrame> {
    let frame: Frame;
    let alreadyFailedOver = false;
    try {
      frame = await deps.onDisplay();
    } catch (err) {
      if (!deps.errorJsx) throw err;
      frame = errorFrame(asError(err));
      alreadyFailedOver = true;
    }

    try {
      return await renderToFrame(frame);
    } catch (err) {
      if (alreadyFailedOver || !deps.errorJsx) throw err;
      return await renderToFrame(errorFrame(asError(err)));
    }
  }

  return {
    async ensureFrame() {
      if (current && current.validUntil > now()) return current;
      if (inFlight) return inFlight;
      inFlight = startRender().then((frame) => {
        current = frame;
        return frame;
      });
      try {
        return await inFlight;
      } finally {
        inFlight = null;
      }
    },
    getJobHtml(jobId) {
      return jobs.get(jobId)?.html;
    },
    getJobPng(jobId) {
      return jobs.get(jobId)?.png;
    },
    renderEphemeral(jsx) {
      return rasterizeJsx(jsx);
    },
  };
}

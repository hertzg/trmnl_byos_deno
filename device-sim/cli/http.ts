// A failure the operator can read and act on, reported without a stack trace.
// main.ts catches this one class and prints its message; anything else is a
// bug in the tool and keeps its stack.
export class RequestFailed extends Error {}

// `fetch` rejects with a bare "fetch failed" TypeError and hides the real
// reason (connection refused, DNS) one level down in `cause`, so unwrap it and
// name the request that failed.
export async function request(
  method: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const detail = error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : String(error);
    throw new RequestFailed(`${method} ${url} failed\n  ${detail}`);
  }
}

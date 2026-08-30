import { assertEquals, assertInstanceOf } from "@std/assert";
import { stub } from "@std/testing/mock";
import { request, RequestFailed } from "./http.ts";

Deno.test("request returns the response when the server answers", async () => {
  using _fetch = stub(
    globalThis,
    "fetch",
    () => Promise.resolve(new Response("pong", { status: 200 })),
  );

  const res = await request("GET", "http://localhost:3000/api/setup");
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "pong");
});

Deno.test("request surfaces the cause fetch hides behind 'fetch failed'", async () => {
  const refused = new TypeError("fetch failed", {
    cause: new Error("tcp connect error: Connection refused (os error 61)"),
  });
  using _fetch = stub(globalThis, "fetch", () => Promise.reject(refused));

  const error = await request("GET", "http://localhost:3000/api/display").catch((e) => e);
  assertInstanceOf(error, RequestFailed);
  assertEquals(
    error.message,
    "GET http://localhost:3000/api/display failed\n" +
      "  tcp connect error: Connection refused (os error 61)",
  );
});

Deno.test("request falls back to the error itself when there is no cause", async () => {
  using _fetch = stub(globalThis, "fetch", () => Promise.reject(new TypeError("fetch failed")));

  const error = await request("POST", "http://localhost:3000/api/log").catch((e) => e);
  assertInstanceOf(error, RequestFailed);
  assertEquals(
    error.message,
    "POST http://localhost:3000/api/log failed\n  TypeError: fetch failed",
  );
});

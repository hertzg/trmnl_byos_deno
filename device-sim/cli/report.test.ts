import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { decodeText, logExchange, printResult } from "./report.ts";

// Collects what the code under test printed, so the assertions read as the
// terminal output a developer would actually see.
function captureLines(run: () => void): string[] {
  const lines: string[] = [];
  using _log = stub(console, "log", (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  run();
  return lines;
}

// The Response constructor does not infer statusText from status, but a real
// fetch response carries whatever the server sent, so fixtures spell it out.
function responseOf(contentType: string, status = 200, statusText = "OK"): Response {
  return new Response(null, { status, statusText, headers: { "content-type": contentType } });
}

Deno.test("decodeText decodes a json body", () => {
  const bytes = new TextEncoder().encode('{"status":0}');
  assertEquals(decodeText(responseOf("application/json"), bytes), '{"status":0}');
});

Deno.test("decodeText decodes a text body", () => {
  const bytes = new TextEncoder().encode("Not Found");
  assertEquals(decodeText(responseOf("text/plain; charset=UTF-8"), bytes), "Not Found");
});

Deno.test("decodeText refuses a png body", () => {
  assertEquals(decodeText(responseOf("image/png"), new Uint8Array([137, 80, 78, 71])), null);
});

Deno.test("decodeText refuses a body with no content-type", () => {
  const res = new Response(null, { status: 200 });
  res.headers.delete("content-type");
  assertEquals(decodeText(res, new Uint8Array([1, 2, 3])), null);
});

Deno.test("logExchange marks sent lines with > and received lines with <", () => {
  const lines = captureLines(() =>
    logExchange({
      method: "GET",
      url: "http://localhost:3000/api/setup",
      headers: new Headers({ "ID": "AA:BB:CC:DD:EE:FF" }),
      res: responseOf("application/json"),
      responseBody: '{"status":200}',
    })
  );
  assertEquals(lines[0], "> GET http://localhost:3000/api/setup");
  assertEquals(lines[1], ">   id: AA:BB:CC:DD:EE:FF");
  assertEquals(lines.at(-1), '< {"status":200}');
});

Deno.test("logExchange prints a request body when there is one", () => {
  const lines = captureLines(() =>
    logExchange({
      method: "POST",
      url: "http://localhost:3000/api/log",
      headers: new Headers(),
      body: '{"logs":[]}',
      res: new Response(null, { status: 204, statusText: "No Content" }),
      responseBody: "",
    })
  );
  assertEquals(lines.includes('> {"logs":[]}'), true);
});

Deno.test("logExchange summarises a binary body instead of printing it", () => {
  const lines = captureLines(() =>
    logExchange({
      method: "GET",
      url: "http://localhost:3000/image/wedge.png",
      headers: new Headers(),
      res: responseOf("image/png"),
      responseBody: null,
    })
  );
  assertEquals(lines.at(-1), "<   (binary body, not shown)");
});

Deno.test("printResult prints just the body when the request succeeded", () => {
  const lines = captureLines(() => printResult(responseOf("application/json"), '{"status":0}'));
  assertEquals(lines, ['{"status":0}']);
});

Deno.test("printResult leads with the status when the request failed", () => {
  const lines = captureLines(() =>
    printResult(responseOf("text/plain", 404, "Not Found"), "Not Found")
  );
  assertEquals(lines, ["404 Not Found", "Not Found"]);
});

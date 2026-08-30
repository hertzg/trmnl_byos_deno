// Whether a response body is safe to print. The PNG is not, so --debug
// summarises it by length instead of spraying bytes at the terminal.
export function decodeText(res: Response, bytes: Uint8Array): string | null {
  const type = res.headers.get("content-type") ?? "";
  const textual = /^text\//.test(type) || /\bjson\b/.test(type) ||
    /\bxml\b/.test(type);
  return textual ? new TextDecoder().decode(bytes) : null;
}

export type Exchange = {
  method: string;
  url: string;
  headers: Headers;
  body?: string;
  res: Response;
  responseBody: string | null;
};

// The --debug dump: everything sent and everything received, prefixed `>` and
// `<` so the two directions stay apart. Only --debug calls this — the plain
// path prints each subcommand's own result instead, and stays quiet.
export function logExchange(exchange: Exchange): void {
  const { method, url, headers, body, res, responseBody } = exchange;
  console.log(`> ${method} ${url}`);
  for (const [name, value] of headers) console.log(`>   ${name}: ${value}`);
  if (body !== undefined) {
    console.log(">");
    for (const line of body.split("\n")) console.log(`> ${line}`);
  }
  console.log(`< ${res.status} ${res.statusText}`);
  for (const [name, value] of res.headers) console.log(`<   ${name}: ${value}`);
  if (responseBody === null) {
    console.log("<   (binary body, not shown)");
  } else if (responseBody !== "") {
    console.log("<");
    for (const line of responseBody.split("\n")) console.log(`< ${line}`);
  }
}

// Without --debug the HTTP status is only worth a line when it went wrong;
// on success the body (or the saved file) is the whole story.
export function printResult(res: Response, body: string): void {
  if (!res.ok) console.log(`${res.status} ${res.statusText}`);
  console.log(body);
}

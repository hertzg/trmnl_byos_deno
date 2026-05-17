/** @jsxImportSource hono/jsx */

// Dashboard at /. Slice #52 trimmed this down to the minimum the
// orchestration story needs: a heading, the current Image (or a notice
// when the Slot is empty / refill failed), the current Slot identity and
// remaining validity, and a placeholder scrub form whose action goes
// nowhere until slice #54 restores it.

export type DashboardProps = {
  now: Temporal.ZonedDateTime;
  // `null` when the Slot is empty after a refill attempt (e.g. the
  // Conductor's error path itself failed) — the page surfaces that state
  // instead of trying to embed a broken /image URL.
  identity: string | null;
  refreshIn: Temporal.Duration | null;
};

function fmtTime(t: Temporal.ZonedDateTime): string {
  return t.toPlainDateTime().toString({ smallestUnit: "second" }).replace("T", " ");
}

function fmtSeconds(totalSec: number): string {
  const t = Math.round(totalSec);
  if (t === 0) return "0s";
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  if (m) return s ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

function fmtDuration(d: Temporal.Duration): string {
  return fmtSeconds(d.total({ unit: "seconds" }));
}

function toDatetimeLocal(t: Temporal.ZonedDateTime): string {
  return t.toPlainDateTime().toString({ smallestUnit: "minute" });
}

const css = `
  html, body { margin: 0; padding: 0; background: #f4f4f4; color: #111; }
  body {
    font-family: -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
    padding: 24px;
    max-width: 980px;
    margin: 0 auto;
  }
  h1 { margin: 0 0 16px; font-size: 20px; letter-spacing: -0.01em; }
  form { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
  form label { font-size: 13px; color: #555; }
  form input[type="datetime-local"] {
    font: inherit; padding: 6px 8px; border: 1px solid #bbb; background: #fff;
  }
  form button { font: inherit; padding: 6px 12px; border: 1px solid #111; background: #111; color: #fff; cursor: pointer; }
  .image-frame {
    background: #fff; border: 1px solid #ddd; padding: 12px;
    display: inline-block; margin-bottom: 16px;
  }
  .image-frame img { display: block; max-width: 100%; image-rendering: pixelated; }
  table.meta {
    border-collapse: collapse; width: 100%; font-size: 13px;
    background: #fff; border: 1px solid #ddd; margin-bottom: 16px;
  }
  table.meta th, table.meta td { padding: 6px 12px; text-align: left; vertical-align: top; }
  table.meta tbody th {
    width: max-content; color: #555; font-weight: normal; white-space: nowrap;
    border-right: 1px solid #eee;
  }
  table.meta tbody td { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  table.meta .muted { color: #888; font-family: inherit; font-style: italic; }
  p.head { margin: 8px 0 16px; font-size: 12px; color: #555; }
  p.head code { font-family: ui-monospace, "SF Mono", Menlo, monospace; color: #111; }
  p.notice {
    margin: 0 0 16px; padding: 8px 12px; font-size: 13px;
    background: #fffbe6; border: 1px solid #f0c040; color: #663d00;
  }
  p.notice code { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  p.deferred {
    margin: 0 0 16px; padding: 8px 12px; font-size: 12px; color: #555;
    background: #f0f0f0; border: 1px solid #ddd;
  }
`;

export default function Dashboard(props: DashboardProps) {
  const { now, identity, refreshIn } = props;
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <title>trmnl-byos dashboard</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <h1>dashboard</h1>
        <p class="head">
          now: <code>{fmtTime(now)}</code> · timezone: <code>{now.timeZoneId}</code>
        </p>
        <p class="deferred">
          scrub at arbitrary <code>t</code>{" "}
          is deferred to a later slice; the form below is a placeholder.
        </p>
        <form method="get" action="/">
          <label for="t">t</label>
          <input
            type="datetime-local"
            id="t"
            name="t"
            value={toDatetimeLocal(now)}
            disabled
          />
          <button type="submit" disabled>scrub</button>
        </form>
        {identity !== null
          ? (
            <div class="image-frame">
              <img src={`/image/${identity}.png`} alt="current Image" />
            </div>
          )
          : (
            <p class="notice">
              Slot is empty — Conductor refill failed. Try reloading the page.
            </p>
          )}
        <table class="meta">
          <tbody>
            <tr>
              <th scope="row">identity</th>
              <td>{identity ?? <span class="muted">(none)</span>}</td>
            </tr>
            <tr>
              <th scope="row">refresh in</th>
              <td>
                {refreshIn !== null ? fmtDuration(refreshIn) : <span class="muted">(unknown)</span>}
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

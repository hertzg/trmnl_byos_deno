// The control page, served at GET /notice/app and saved to the iPhone Home
// Screen. One file, no build step, no dependencies: plain HTML, CSS and JS in
// a template literal. This is a V0 that might be deleted; it does not get a
// bundler.
//
// It drives the four routes next door and nothing else. No auth, the same
// posture as the dashboard at / — reachable on the LAN or the VPN only
// (ADR-0001).

// 180x180: a white bubble on the accent blue, with the square bottom-left
// corner the panel's own bubbles have. It has to be a PNG — iOS ignores an
// SVG here and falls back to a screenshot of the page — and inlining it as a
// data URI saves the request. iOS caches it at install time, so changing it
// later needs a remove-and-re-add on the phone.
const APPLE_TOUCH_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAIAAACyr5FlAAADg0lEQVR4nOzdMU4WURRHcXfkBlyHG7C2tbM3lK7BloIV2JK4ARNbKGkoABF43ljzJwa4b+bB7+QsgLlzmHlv8mXmzduPF+S9vtn8L+BuFQej4mBUHIyKg1FxMCoORsXBqDgYFQej4mBUHIyKg1FxMCoORsXBqDgYFQej4mBUHIyKg1FxMCoORsXBqDgYFQej4mBUHIyKg1FxMCoORsXBqDgYFQej4mBUHIyKg1FxMCoORsXBqDgYFQej4mBUHIyKg9E9xvH+y9XB4fXR8c2PX7enZ3fjhVKHVgdYh1kHW4e8+dh3HUcN6Nv3Py+4hoepA6/D31Ulu4jj87ff9T808I8aRQ1k85OyfRwfvl7J4l5qLDWcbc/OZnG8+3RZV9GBB6kR1aC2OkfbxFF31p8nLhj/RQ1qq4XIBnHUoZ5fvNJV5+OocW3Sx+w4aqk18Cjmr1KnxlH5DzyBydePeXG4mzydyfeXSXHUktsK9FmoMU7bv0yKw671GalhzjlrM+KohzkDz8qc52Mz4vAM9NmpkU44ce1x2Ls2MWFn2x6Hy0YTEy4evXF4sNFK97a2Nw6blFa6ty29cbzaX+7Moca7ahzuKRNovbM0xnFweD3QTA15yTiOjm8GmqkhLxmHTewEWje0jXFYjU6gdU3aGMfAFMSBiDgQEQci4kBEHIiIAxFxICIORMSBiDgQEQci4kBEHIiIAxFxICIORMSBiDgQEQci4kBEHIiIAxFxICIORMSBiDgQEQci4kBEHIiIAxFxICIORMSBiDgQEQci4sD9eGEcIqu+anKgn1VfUjvQz6qvtx7oZ9UX4w80s/AnNQaaWfhjPAPNLPwZr4FO1v4A4EAna386dKCN5T86PNDG8p8rH+ihe5MijlX5eXL77tPlhDLEsRjnF3fd21dxrMrMMsSxEhP2ruJYj8l3E3EsQ61ANylDHHundq3T9ibiWIZ6BjrnSZc4VqKymL/2FMeuOT27q5vIVssLceyLqqEuEkfHNweH17tqYkYcXF1xMCoORsXBqDgYFQej4mBUHIyKg1FxMCoORsXBqDgYFQej4mBUHIyKg1FxMCoORsXBqDgYFQej4mBUHIyKg1FxMCoORsXBqDgYFQej4mBUHIyKg1FxMCoORsXBqDgYFQej4mBUHIyKg1FxMCoORsXBqDgYFQej4mBUHIyKg1FxMPoXAAD//wMAtN85zTML2SMAAAAASUVORK5CYII=";

export const appPage: string = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Frame</title>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Frame">
<meta name="theme-color" content="#f2f4f7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#101319" media="(prefers-color-scheme: dark)">
<link rel="apple-touch-icon" href="${APPLE_TOUCH_ICON}">
<style>
*, *::before, *::after { box-sizing: border-box; }

:root {
  color-scheme: light dark;
  --bg: #f2f4f7;
  --surface: #ffffff;
  --line: #d9dee6;
  --text: #101319;
  --muted: #5c6472;
  --accent: #2f6df6;
  --on-accent: #ffffff;
  --danger: #c2382b;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #101319;
    --surface: #191d24;
    --line: #2c333f;
    --text: #e9ecf1;
    --muted: #98a1b1;
    --accent: #6b95ff;
    --on-accent: #0d1017;
    --danger: #f07a6c;
  }
}

html, body { margin: 0; padding: 0; }

/* viewport-fit=cover without these insets puts the composer under the notch
   and the Send button under the home indicator in standalone mode. */
body {
  background: var(--bg);
  color: var(--text);
  font: 17px/1.4 -apple-system, "SF Pro Text", system-ui, sans-serif;
  -webkit-text-size-adjust: 100%;
  max-width: 560px;
  margin: 0 auto;
  padding:
    calc(16px + env(safe-area-inset-top))
    calc(16px + env(safe-area-inset-right))
    calc(24px + env(safe-area-inset-bottom))
    calc(16px + env(safe-area-inset-left));
}

button {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
  /* Everything tappable clears the 44px one-handed target. */
  min-height: 44px;
}

/* ---- compose ---- */

#compose {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

#text {
  font: inherit;
  color: inherit;
  width: 100%;
  min-height: 96px;
  padding: 12px 14px;
  resize: vertical;
  background: var(--surface);
  border: 1px solid var(--line);
  /* Square bottom-left, the same tell the panel's bubbles carry. */
  border-radius: 14px 14px 14px 4px;
}

#text:focus-visible, button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  padding: 0 14px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 999px;
}

.chip[aria-pressed="true"] {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}

.actions {
  display: flex;
  align-items: stretch;
  gap: 8px;
}

/* The icon inherits currentColor, so it turns accent once a photo is on. */
#photo-btn {
  display: grid;
  place-items: center;
  width: 52px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
}

#photo-btn[aria-pressed="true"] {
  color: var(--accent);
  border-color: var(--accent);
}

#send {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-weight: 600;
  background: var(--accent);
  color: var(--on-accent);
  border-radius: 14px;
}

#send[disabled] { opacity: 0.55; }

#photo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
}

#photo-img {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 10px;
}

#photo-size {
  flex: 1;
  font-size: 14px;
  color: var(--muted);
}

#photo-drop {
  display: grid;
  place-items: center;
  width: 44px;
  color: var(--muted);
  border-radius: 12px;
}

#status {
  margin: 0;
  /* Reserved so the page does not jump when the line appears. */
  min-height: 1.4em;
  font-size: 15px;
  color: var(--muted);
}

/* ---- the live list ---- */

.live-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin: 28px 0 10px;
}

.live-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}

#clear {
  padding: 0;
  font-size: 15px;
  color: var(--danger);
}

#clear[disabled] { color: var(--muted); opacity: 0.55; cursor: default; }

#list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 8px 10px 14px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px 14px 14px 4px;
}

.notice-main { flex: 1; min-width: 0; }

.notice-text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.notice-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 4px 0 0;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 13px;
  color: var(--muted);
}

.notice-meta svg { display: block; }

.remove {
  display: grid;
  place-items: center;
  width: 44px;
  color: var(--muted);
  border-radius: 12px;
}

#empty {
  margin: 0;
  font-size: 15px;
  color: var(--muted);
}

[hidden] { display: none !important; }
</style>
</head>
<body>

<form id="compose">
  <textarea id="text" rows="3" placeholder="Message the frame" autocomplete="off"></textarea>

  <div id="photo" hidden>
    <img id="photo-img" alt="">
    <span id="photo-size"></span>
    <button type="button" id="photo-drop" aria-label="Remove the photo">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
  </div>

  <div class="chips" role="group" aria-label="How long it stays">
    <button type="button" class="chip" data-minutes="15" aria-pressed="true">15 min</button>
    <button type="button" class="chip" data-minutes="60" aria-pressed="false">1 hour</button>
    <button type="button" class="chip" data-minutes="180" aria-pressed="false">3 hours</button>
    <button type="button" class="chip" data-minutes="480" aria-pressed="false">8 hours</button>
  </div>

  <div class="actions">
    <input type="file" id="file" accept="image/*" hidden>
    <button type="button" id="photo-btn" aria-pressed="false" aria-label="Add a photo">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="3"/><circle cx="8.5" cy="10" r="1.8"/><path d="M21 15.5l-4.5-4.5-7 7"/></svg>
    </button>
    <button type="submit" id="send">
      Send
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
    </button>
  </div>

  <p id="status" role="status"></p>
</form>

<section>
  <div class="live-head">
    <h2>On the frame</h2>
    <button type="button" id="clear" disabled>Clear all</button>
  </div>
  <ul id="list"></ul>
  <p id="empty">Nothing on the frame.</p>
</section>

<template id="row">
  <li class="notice">
    <div class="notice-main">
      <p class="notice-text"></p>
      <p class="notice-meta">
        <span class="sent"></span>
        <span class="left"></span>
        <span class="has-photo" hidden>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><title>has a photo</title><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 15l-4.5-4.5-7 7"/></svg>
        </span>
      </p>
    </div>
    <button type="button" class="remove" aria-label="Remove this notice">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
  </li>
</template>

<script>
(function () {
  var form = document.getElementById('compose');
  var textEl = document.getElementById('text');
  var fileEl = document.getElementById('file');
  var photoBtn = document.getElementById('photo-btn');
  var photoBox = document.getElementById('photo');
  var photoImg = document.getElementById('photo-img');
  var photoSize = document.getElementById('photo-size');
  var photoDrop = document.getElementById('photo-drop');
  var sendBtn = document.getElementById('send');
  var statusEl = document.getElementById('status');
  var listEl = document.getElementById('list');
  var emptyEl = document.getElementById('empty');
  var clearBtn = document.getElementById('clear');
  var rowTpl = document.getElementById('row');
  var chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));

  // id -> { left: HTMLElement, expiresAt: Date }. Rebuilt only when the set of
  // live notices actually changes, so a poll every second does not steal
  // focus from a Remove button under a thumb.
  var rows = [];
  var signature = null;

  // ---- compose ----

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      chips.forEach(function (other) {
        other.setAttribute('aria-pressed', other === chip ? 'true' : 'false');
      });
    });
  });

  function minutes() {
    for (var i = 0; i < chips.length; i++) {
      if (chips[i].getAttribute('aria-pressed') === 'true') return chips[i].dataset.minutes;
    }
    return '15';
  }

  photoBtn.addEventListener('click', function () { fileEl.click(); });
  photoDrop.addEventListener('click', dropPhoto);
  fileEl.addEventListener('change', function () {
    var file = fileEl.files[0];
    if (!file) return dropPhoto();
    photoImg.src = URL.createObjectURL(file);
    photoSize.textContent = formatSize(file.size);
    photoBox.hidden = false;
    photoBtn.setAttribute('aria-pressed', 'true');
  });

  function dropPhoto() {
    fileEl.value = '';
    if (photoImg.src) URL.revokeObjectURL(photoImg.src);
    photoImg.removeAttribute('src');
    photoBox.hidden = true;
    photoBtn.setAttribute('aria-pressed', 'false');
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' kB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // Enter sends; Shift-Enter is a newline. On a phone this is the Return key
  // on a hardware keyboard, and harmless without one.
  textEl.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var text = textEl.value.trim();
    if (text === '') return;

    var body = new FormData();
    body.set('text', text);
    body.set('minutes', minutes());
    if (fileEl.files[0]) body.set('image', fileEl.files[0]);

    sendBtn.disabled = true;
    fetch('/notice', { method: 'POST', body: body })
      .then(function (res) {
        return res.json().then(function (payload) {
          if (!res.ok) throw new Error(payload.error || 'Rejected.');
          return payload;
        });
      })
      .then(function (payload) {
        textEl.value = '';
        dropPhoto();
        statusEl.textContent = landingLine(payload.showsAt);
        return refresh();
      })
      .catch(function (err) {
        statusEl.textContent = err.message || 'No answer from the server.';
      })
      .then(function () { sendBtn.disabled = false; });
  });

  // The Device only ever sees a notice on its next poll, and showsAt is that
  // poll. Awake, it is bounded by the Super-Plugin's own numbers: never
  // sooner than the 5-minute battery floor (plugins/home/compose.ts), never
  // later than the gallery branch's 15-minute change-detection cap
  // (plugins/gallery/rotation.ts). Asleep, it is hours out. 25 minutes clears
  // the awake ceiling with room to spare and is nowhere near a sleep window,
  // so the two cases never trade lines.
  var SOON_MS = 25 * 60 * 1000;

  function landingLine(showsAt) {
    var at = new Date(showsAt);
    if (at.getTime() - Date.now() <= SOON_MS) return 'On the frame.';
    return 'Queued — it lands at ' + clockTime(at) + '.';
  }

  function clockTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ---- the live list ----

  function refresh() {
    return fetch('/notice')
      .then(function (res) { return res.json(); })
      .then(function (payload) { render(payload.notices); })
      // A dropped poll on a LAN is not worth a line of its own; the next one
      // is a second away.
      .catch(function () {});
  }

  function render(notices) {
    var next = notices.map(function (n) { return n.id + '@' + n.expiresAt; }).join('|');
    if (next !== signature) {
      signature = next;
      rebuild(notices);
    }
    tick();
  }

  function rebuild(notices) {
    listEl.textContent = '';
    rows = [];
    // GET /notice lists oldest first, so appending in order puts the newest
    // last — the same order the panel draws.
    notices.forEach(function (notice) {
      var li = rowTpl.content.firstElementChild.cloneNode(true);
      // textContent, never markup: a stray "<" in a notice must not eat the
      // rest of the list.
      li.querySelector('.notice-text').textContent = notice.text;
      li.querySelector('.sent').textContent = clockTime(new Date(notice.receivedAt));
      li.querySelector('.has-photo').hidden = !notice.hasImage;
      li.querySelector('.remove').addEventListener('click', function () {
        removeOne(notice.id);
      });
      listEl.appendChild(li);
      rows.push({ left: li.querySelector('.left'), expiresAt: new Date(notice.expiresAt) });
    });
    emptyEl.hidden = notices.length > 0;
    clearBtn.disabled = notices.length === 0;
  }

  function tick() {
    rows.forEach(function (row) { row.left.textContent = remaining(row.expiresAt); });
  }

  function remaining(expiresAt) {
    var ms = expiresAt.getTime() - Date.now();
    if (ms <= 0) return 'gone';
    var mins = Math.ceil(ms / 60000);
    if (mins < 60) return mins + ' min left';
    var hours = Math.floor(mins / 60);
    var rest = mins % 60;
    return rest === 0 ? hours + 'h left' : hours + 'h ' + rest + 'm left';
  }

  function removeOne(id) {
    fetch('/notice/' + encodeURIComponent(id), { method: 'DELETE' }).then(refresh);
  }

  clearBtn.addEventListener('click', function () {
    if (!confirm('Remove every notice from the frame?')) return;
    fetch('/notice', { method: 'DELETE' }).then(refresh);
  });

  refresh();
  // One second is fine on a LAN, and it doubles as the clock for the
  // remaining-time labels.
  setInterval(refresh, 1000);
})();
</script>

</body>
</html>
`;

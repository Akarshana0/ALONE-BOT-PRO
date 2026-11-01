# 🤖⚡ ALONE — Futuristic WhatsApp Bot
Owner: **AKARSHANA** · Engine: Baileys (`@whiskeysockets/baileys`) · Node 20+ · MongoDB · Heroku-ready

## Structure
```
index.js                  entry (DB → commands → sessions)
Procfile / app.json / setup.sh   Heroku deployment
src/config.js             env config
src/database/index.js     Mongo models (auth keys, sessions, users+language, settings, groups, vault)
src/session/authState.js  Baileys auth state in MongoDB  (Heroku-safe sessions)
src/session/manager.js    multi-session manager: MAIN + linked users, pairing, reconnect, REMOTE DISCONNECT
src/core/handler.js       message pipeline + permission checks + command dispatch
src/core/commandLoader.js auto-loads every file in src/commands (add a file = add commands)
src/core/ui.js            interactive buttons/lists (+ automatic text fallback)
src/core/menus.js         main / category / all-commands menus
src/core/i18n.js + locales/   EN · සිංහල · العربية · हिन्दी (UI strings) + auto-translation of dynamic text
src/core/settings.js      feature registry → `.settings` ON/OFF dashboard (session + group scope)
src/core/vault.js         Anti-Delete, VIP owner protection, View-Once retriever
src/core/moderation.js    anti-link / bad-word / bot / spam + warn system
src/core/cards.js         cyberpunk welcome/goodbye cards
src/core/film.js          🎞️ full-film engine: disk streaming, resume, ffmpeg HD merge, queue, cleanup
src/commands/*.js         main, owner, group, download (+film), ai, tools, fun, image(+logo maker), info
test/                     offline self-tests  →  npm test
```

## Deploy (Heroku)
1. Create a free MongoDB Atlas cluster → copy the connection string.
2. `cp .env.example .env` and fill `MONGODB_URI` (and keys you want).
3. `bash setup.sh heroku <your-app-name>` (needs Heroku CLI + git) — or push manually and set the config vars from `app.json`.
4. `heroku logs --tail -a <app>` → a **pairing code** appears for `PAIR_NUMBER`. WhatsApp → Linked devices → *Link with phone number* → enter it.
5. Send `.menu` to the bot. Sessions live in MongoDB so dyno restarts do not log you out.

Local: `bash setup.sh local` → `npm start`.

## 🎞️ Full films — ONE file, no size drama
`.film <title>` searches **full-length films** (YouTube + the Internet Archive's free / public-domain library) and you tap one to receive it as **a single WhatsApp document** (up to ~1.8 GB, WhatsApp's limit is 2 GB).

| Command | What it does |
|---|---|
| `.film <title>` | Search → pick (best quality / 480p data-saver / free-archive sections) |
| `.filmdl <YouTube link \| ia:id> [480\|720\|1080]` | Download any long video or a specific film directly |
| `.filmstatus` | Show the queue |
| `.filmcancel [id]` | Cancel your download (owner can cancel any job id) |

How it stays reliable:
* **Streams to disk**, never into RAM — a 1.5 GB film needs only ~20 MB of memory (safe on a Heroku basic dyno).
* **Auto quality**: starts at `FILM_QUALITY` (default 720p) and steps down until the file fits `MAX_FILM_MB` *and* the free disk. HD video + audio are merged with ffmpeg (stream copy, takes seconds); falls back to muxed 360p.
* **Resumes** after network drops (HTTP Range) and has a stall watchdog — it never restarts from zero.
* **Queue** (`FILM_CONCURRENCY`, default 1) + one film per user at a time (owner exempt) + live progress message that edits itself: queued → downloading % / speed / ETA → merging → uploading → delivered.
* Temp files are always removed (after delivery, on errors, on cancel, on restart/shutdown).
* Survives WhatsApp reconnects during a long upload (retries delivery on the fresh socket).

Config (all optional, see `.env.example`): `MAX_FILM_MB`, `FILM_QUALITY`, `FILM_MAX_MINUTES`, `FILM_CONCURRENCY`, `FILM_QUEUE_MAX`, `TMP_DIR`.

**YouTube says "confirm you're not a bot" on Heroku?** Datacenter IPs get challenged. Fix: export your YouTube cookies as a JSON array (browser extension "EditThisCookie"/"Cookie-Editor" → Export as JSON), then `heroku config:set YT_COOKIES='[...]' -a <app>` (use a throw-away Google account). A residential/HTTP proxy also works: `YT_PROXY=http://user:pass@host:port`.

## ⚠️ Important notes
* **VIP Anti-Delete works when the MAIN session is the owner's own WhatsApp number** (set `PAIR_NUMBER` to it). Then every DM that reaches the owner is cached and, if the sender deletes it for everyone, resent to the owner. WhatsApp cannot be prevented from deleting a message on the recipient's device — the bot preserves and re-delivers it.
* **Owner Delete Override**: `.del` (reply to a message) and `.purge [n]` issue "delete for everyone". WhatsApp's servers enforce their own time window for revoking old messages; the bot cannot override that.
* **Remote Disconnect**: `.disconnect <sessionId|number|all>` logs the linked device out, wipes its credentials from MongoDB and tells that user. `.sessions` lists them. (`.disconnect main` unlinks the main session.)
* **Privacy design for linked users** (`.connect <number>`): the user gets a consent notice, can `.logout` anytime, linked sessions are *private mode* by default (only that user + owner can run commands), and automation features (anti-delete, view-once retriever, auto-read…) are **OFF by default** and send results only to that user's own chat — never to the bot owner.
* Interactive buttons are unofficial on non-Business accounts; WhatsApp may stop rendering them. Toggle `.set buttons off` (or the dashboard) for a pure text menu — everything still works.
## 📥 Auto Link Downloader
Send (or forward) a link in any chat the bot can read and it downloads the **photo / video / audio** automatically — no command needed.
Supported: TikTok, Instagram (reels, posts, carousels), Facebook, Twitter/X, Pinterest, Threads, YouTube (videos up to ~25 min), SoundCloud, MediaFire, Google Drive, CapCut.
* Reactions show progress: ⏳ working → ✅ sent / ❌ failed.
* Toggle: `.set autodl on` / `.set autodl off` (default **ON**, also in the settings dashboard).
* Manual fallbacks still exist: `.download <link>` (or reply to a message with a link), `.tiktok`, `.ig`, `.fb`, `.x`, `.pin` …
* Files above `MAX_MEDIA_MB` (default 60) are skipped with a notice.

* Downloaders depend on third-party libraries/sites (`@distube/ytdl-core`, `btch-downloader`) that break from time to time; YouTube often blocks datacenter IPs. Update the packages if a downloader stops working. No piracy-site scrapers are included — `.film` only uses YouTube and the Internet Archive; please only download films you have the right to (public-domain, free uploads by the rights holder, your own content).
* Using unofficial clients can get a number banned by WhatsApp. Use a spare number for the bot.
* Logos render locally with SVG→PNG (no API). Latin text looks best; add fonts to the dyno for other scripts.

## Add a command
Create `src/commands/mine.js`:
```js
module.exports = [{ name: 'hello', category: 'fun', desc: 'Say hi', run: async (c) => c.reply(c.t('done')) }];
```
Flags: `owner`, `admin`, `botAdmin`, `group`, `need` (requires input), `usage`, `aliases`, `anySession`.
Run `npm run commands` to print the command count and `npm test` to run the offline self-tests (film engine + commands, no network needed).

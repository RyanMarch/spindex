# Spindex

Browse your Discogs record collection like flipping through a crate. Local-first: your collection is saved in your
browser, and works offline once loaded.

## Overview

- **Stack**: Vanilla HTML, CSS custom properties and ES modules. No client-side framework or bundler.
- **Storage**: Browser IndexedDB (`spindex_db`, `records` store). No hosted database.
- **Server**: Cloudflare Pages Functions (`functions/`) for Discogs sign-in, a read-only Discogs proxy, and a Deezer lookup.
- **Data sources**:
  - Discogs: your collection, release details, tracklists, credits, pressings and condition grades.
  - iTunes Search: high-resolution cover art, primary genre and Apple Music links.
  - Wikipedia, Wikidata and Wikimedia Commons: liner notes, artist bios, links and portraits.
  - MusicBrainz and the Cover Art Archive: back covers.
  - Deezer: album links.

## Features

- **3D crate**: a flip-through stack built from CSS 3D transforms. Arrow keys, letter jumps, mouse wheel and touch swipes.
- **Browse**: genre tabs built from your collection (a record can carry several genre tags), sorting, and search by
  title or artist (press `/`).
- **Album page** (`/album/<artist>/<title>/`): tracklist, credits, liner notes, your copy (condition and added date),
  the artist, videos, listening links, a flippable sleeve with the pressing's real disc colour, and links to other
  records in your crate. Sections with nothing to show are hidden.
- **Phones and tablets**: touch-sized controls, safe-area support, and layouts for portrait and landscape.
- **Demo crate**: a first visit (before Discogs is connected) shows a built-in 12-album collection. It goes away once you connect. Add `?demo` to the address to reload it while testing.
- **Grid and list views**, filters (decade, size, pressing, discs, speed), a jump rail (A to Z or decades), "surprise me", and a `?` list of keyboard shortcuts.
- **Read-only link**: Settings > Share your crate publishes a snapshot others can browse at `/s/<id>`. See "Sharing" below.
- **Stays up to date by itself**: opening the app (or coming back to it) checks Discogs for new records when it has been a few hours. Settings shows when it last checked.

## Local development

```bash
npm install
npm run dev      # http://localhost:8780
npm test
```

`npm test` runs syntax checks for every source file, the parsers and matching logic, the demo data, and an end-to-end
test of the Discogs sign-in against a mock Discogs server.

## Directory structure

```
├── public/                    Static site
│   ├── index.html             Page shell, crate stage, album page, settings
│   ├── manifest.webmanifest, sw.js, 404.html, _redirects, assets/
│   ├── css/style.css
│   └── js/
│       ├── app.js             Orchestration: browse, search, routing, settings
│       ├── crate.js           The 3D crate: physics, gestures, keyboard
│       ├── notes.js           The album page
│       ├── sync.js            Discogs sync, iTunes enrichment, credits and genre logic
│       ├── discogs.js         How this browser talks to Discogs (sign-in or token)
│       ├── wiki.js            Wikipedia, Wikidata, MusicBrainz and cover-art lookups
│       ├── vinyl.js           Pressing description to disc colour and finish
│       ├── values.js          Placeholder-value helper
│       ├── db.js              IndexedDB
│       └── mock-data.js       Demo crate
├── functions/                 Cloudflare Pages Functions
│   ├── _lib/                  Shared: OAuth, sessions, proxy allowlist, Deezer matching
│   └── api/                   discogs/*, listen/deezer, health
├── tests/                     syntax, basic, vinyl, logic and OAuth tests
├── package.json, wrangler.toml
└── .dev.vars.example          Local secrets template
```

## Discogs sign-in

"Connect Discogs" uses Discogs' OAuth 1.0a flow. The consumer secret never reaches the browser: Pages Functions in
`functions/api/discogs/` run the login, keep the user's access token in an encrypted HttpOnly cookie, and proxy the
read-only Discogs requests Spindex needs (`/api/discogs/...`). A personal access token (Settings, "Use a personal access
token instead") still works as a local fallback.

**Set up (local)**
1. On discogs.com, Settings, Developers, create an application. Set its callback URL to
   `http://localhost:8780/api/discogs/callback` (use a separate application for production).
2. Copy `.dev.vars.example` to `.dev.vars` and fill in `DISCOGS_CONSUMER_KEY`, `DISCOGS_CONSUMER_SECRET` and a long random
   `SESSION_SECRET` (`openssl rand -base64 32`). `.dev.vars` is git-ignored.
3. Restart `npm run dev`. Settings now shows **Connect Discogs**.

**Set up (production, Cloudflare Pages)**
1. Create a second Discogs application whose callback URL is `https://<your-domain>/api/discogs/callback`.
2. Add `DISCOGS_CONSUMER_KEY`, `DISCOGS_CONSUMER_SECRET` and `SESSION_SECRET` as encrypted environment variables (Pages
   project, Settings, Variables and Secrets), or with `wrangler pages secret put <NAME>`.

**Notes**
- Discogs' API terms are honored in the UI: the trademark notice sits with the sign-in (Settings) and at the bottom of each album page, with a "Data provided by Discogs" link to the release's Discogs page.
- One crate per browser: connecting a different Discogs account asks before replacing the local crate.
- The proxy is read-only and allowlisted (your own collection, releases, masters, artists). Nothing is cached server-side.
- `npm test` includes an end-to-end OAuth test against a mock Discogs server (`tests/oauth-test.mjs`).

## Sharing (the read-only link)

A signed-in owner can publish a trimmed snapshot of their collection (titles, artists, years, genres, covers, tracklists
and pressing formats; never notes, conditions or anything gathered from other sources). Anyone with the link,
`/s/<20 random characters>`, can browse it read-only. It is unlisted, not secret. Republishing keeps the same link,
and "Stop sharing" makes it stop working.

It needs a Cloudflare KV namespace bound as `SHARES`. Without one the feature reports itself unavailable and its
Settings section stays hidden.

- Local: `npm run dev` already passes `--kv SHARES`.
- Production: create a KV namespace (Workers & Pages > KV), then bind it to the Pages project as `SHARES`
  (Settings > Functions > KV namespace bindings, for Production).

A shared crate opens in a browser database of its own, so a visitor's own collection is never touched.

## Deploying (Cloudflare Pages)

1. Create a Pages project from this repo: no build command, output directory `public`.
2. Register a production Discogs application with callback `https://<your-domain>/api/discogs/callback` (for example `https://spindex.ryanmarch.me/api/discogs/callback`).
3. Set `DISCOGS_CONSUMER_KEY`, `DISCOGS_CONSUMER_SECRET` and `SESSION_SECRET` (a new `openssl rand -base64 32`) as
   encrypted Production variables.
4. Add the custom domain (sign-in needs HTTPS).
   Optional: bind a KV namespace as `SHARES` to turn on the read-only link (see "Sharing").
5. Check `/api/health`, then connect Discogs from a phone, sync, and open an album from a direct `/album/...` URL.

Pages keeps every deploy, so a bad release can be rolled back from the dashboard. The service worker is network-first;
bump `CACHE_NAME` in `sw.js` if a change must reach returning visitors immediately.


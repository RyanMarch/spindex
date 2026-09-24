# Crate

A tactile, local-first vinyl record companion and guest browsing web application.

## Overview

- **Stack**: Vanilla HTML5, CSS custom properties, and modern ES6 JavaScript modules. No client-side frameworks or bundlers.
- **Storage Layer**: Native browser IndexedDB (`vinyl_vault_db`, `records` store). Operates offline-first with zero hosted database dependencies.
- **Integrations**:
  - Discogs API: Syncs your collection and release metadata. Sign in with Discogs (OAuth) through Cloudflare Pages Functions, or use a personal access token for local use. See **Discogs sign-in** below.
  - iTunes Search API: Asynchronously enriches album cover art up to 1200x1200 resolution without authentication tokens.
  - Wikimedia REST API: On-demand liner notes and band history loaded into the slide-over drawer.
- **Hosting Target**: Cloudflare Pages static hosting.

## Features

- **3D Flipping Crate**: Tactile digging perspective using pure CSS 3D transforms (`perspective: 1200px`, `transform-style: preserve-3d`).
- **Input Gestures**: Supports left/right and up/down arrow keys, touch swipe gestures on mobile and tablets, and debounced mouse wheel scrolling.
- **Divider Tabs & Staff Picks**: Record store category tabs poking above sleeve clusters, plus host pick notes.
- **Liner Notes Drawer**: Slide-over drawer with Side A/Side B track splits and Wikipedia context extracts.
- **Offline & Demo Mode**: Built-in 12-album curated collection loads automatically if the database is unpopulated.

## Local Development

Start the local server (via Wrangler):
```bash
npm run dev
```

Run test suite:
```bash
npm test
```

## Directory Structure

```
├── public/
│   ├── index.html            Shell layout, 3D crate stage, footer, and drawers
│   ├── manifest.webmanifest   PWA manifest
│   ├── sw.js                 Offline Service Worker
│   ├── css/
│   │   └── style.css         3D perspective math, sleeve sheen, and modal layout
│   └── js/
│       ├── app.js            Application orchestration and event binding
│       ├── db.js             Local IndexedDB persistence engine
│       ├── sync.js           Discogs API fetcher and iTunes artwork enrichment
│       ├── crate.js          CrateController for 3D physics and gestures
│       ├── notes.js          RecordDetailModal for sleeve notes and Wikipedia integration
│       └── mock-data.js      Curated default collection for testing
├── tests/
│   └── basic-test.js         Syntax, schema integrity, and rule validation
├── package.json
└── wrangler.toml
```

## Discogs sign-in

"Connect Discogs" uses Discogs' OAuth 1.0a flow. The consumer secret never reaches the browser: Pages Functions in
`functions/api/discogs/` run the login, keep the user's access token in an encrypted HttpOnly cookie, and proxy the
read-only Discogs requests Crate needs (`/api/discogs/...`). A personal access token (Settings, "Use a personal access
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
- One crate per browser: connecting a different Discogs account asks before replacing the local crate.
- The proxy is read-only and allowlisted (your own collection, releases, masters, artists). Nothing is cached server-side.
- `npm test` includes an end-to-end OAuth test against a mock Discogs server (`tests/oauth-test.mjs`).


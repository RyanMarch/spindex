# Crate

A tactile, local-first vinyl record companion and guest browsing web application.

## Overview

- **Stack**: Vanilla HTML5, CSS custom properties, and modern ES6 JavaScript modules. No client-side frameworks or bundlers.
- **Storage Layer**: Native browser IndexedDB (`vinyl_vault_db`, `records` store). Operates offline-first with zero hosted database dependencies.
- **Integrations**:
  - Discogs API: Syncs personal collection and release metadata.
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

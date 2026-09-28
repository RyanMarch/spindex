# Spindex Technical Architecture

This guide documents the technical architecture, data structures, and module layout of Spindex for developers and AI agents working on the codebase.

---

## 1. Architectural Philosophy

Spindex is built as a client-centric, local-first single-page web application. 

Key principles:
- **Zero build step**: The frontend runs directly from raw ES modules, vanilla HTML5, and standard CSS custom properties. There are no bundlers, transpilers, or UI frameworks.
- **Local-first persistence**: The user's collection is stored entirely in the browser's IndexedDB database. Once synchronized, the app can start instantly, browse, filter, search, and inspect album sleeves without an active network connection.
- **Serverless edge support**: Cloudflare Pages Functions act as a lightweight, read-only edge layer for OAuth negotiation, reverse-proxying CORS-restricted APIs, and caching static responses. No user database is hosted on the server.
- **Multi-source enrichment**: Discogs provides core catalog data, while supplemental APIs enrich the collection with high-resolution artwork, back covers, liner notes, artist portraits, and song lyrics.

---

## 2. Product Layout and UI Components

The application interface is organized into distinct functional workspaces within `public/index.html`:

### Primary Stage (`#crate-stage`)
- **3D Crate Flip Stack** (`#crate-stack`, [`crate.js`](file:///Users/ryan/Sites/spindex/public/js/crate.js)): The primary browsing interface. Uses CSS 3D transforms (`rotateX`, `translateZ`) with realistic inertia, drag tracking, and distance fading.
- **Ambient Glow** (`#ambient-glow`, [`crate.js`](file:///Users/ryan/Sites/spindex/public/js/crate.js)): Dual canvas elements that sample the active record's artwork and cast a dynamic, color-matched backdrop glow behind the crate.
- **Metadata Column** (`#station-metadata-col`): Displays active release information alongside the crate, including artist, title, release year, formats, track count, duration, and genres.

### Alternative Browsing Views (`#browse-view`, [`browse.js`](file:///Users/ryan/Sites/spindex/public/js/browse.js))
- **Grid View**: Responsive CSS grid rendering collection artwork.
- **List View**: Dense, scannable tabular view showing title, artist, release year, format, and catalog identifier.
- **Jump Rail** (`#browse-rail`): Edge-positioned alphabet or decade scrubber for rapid collection jumping.

### Gatefold Album Inspector (`#gatefold-workspace`, [`notes.js`](file:///Users/ryan/Sites/spindex/public/js/notes.js))
A full-screen modal representing an open gatefold vinyl jacket:
- **Jacket & Vinyl Simulation** (`#gatefold-jacket-wrap`): A 3D flippable jacket showing front and back artwork. Pulling the record out displays a simulated vinyl disc rendered with realistic grooves, sheen, center label art, and physical vinyl attributes (color, translucency, marbling, splatter, or picture disc).
- **Tracklist Section** (`#gf-tracklist-section`): Track-by-track listing with track durations, side letters, and click-to-view lyrics triggers.
- **Liner Notes Section** (`#gf-story-section`): Background narrative, recording history, and release context pulled from Wikipedia and Wikidata.
- **Credits Section** (`#gf-credits-section`): Personnel roles, instruments, and production credits parsed from Discogs release data.
- **Crate Connections** (`#gf-crate-section`): Internal links to other records in the user's collection by the same artist or sharing the same genre tags.
- **Artist Section** (`#gf-band-section`): Artist biographical summary and Wikimedia Commons portrait photography.
- **Your Copy** (`#gf-copy-section`): Media and sleeve condition grades, date added, personal notes, and artwork verification tools.

### Slide-Over Drawers
- **Browse Drawer** (`#browse-nav`, [`app.js`](file:///Users/ryan/Sites/spindex/public/js/app.js)): Combines collection genre tabs with primary sort selectors (Artist / Year / Title, Artist First Name, Release Year, Recently Added, Genre).
- **Filter Drawer** (`#filter-drawer`, [`filters.js`](file:///Users/ryan/Sites/spindex/public/js/filters.js)): Multi-criteria faceted filtering for decade, record size (12", 7", 10"), pressing type, disc count, and playback speed.
- **Lyrics Drawer** (`#lyrics-drawer`, [`lyrics-drawer.js`](file:///Users/ryan/Sites/spindex/public/js/lyrics-drawer.js)): Slide-over drawer presenting synchronized scrolling lyrics or plain text fetched via [`lyrics.js`](file:///Users/ryan/Sites/spindex/public/js/lyrics.js) from LRCLIB. Includes a track stepper and track selection menu.
- **Statistics Panel** (`#stats-drawer`, [`statsview.js`](file:///Users/ryan/Sites/spindex/public/js/statsview.js)): Sleeve-style collection dashboard featuring decade spine visualizations, pressing color breakdown, cumulative growth timeline chart, and randomly selected collection curiosities ([`stats.js`](file:///Users/ryan/Sites/spindex/public/js/stats.js)).

### Ambient Screensaver Wall (`#wall`, [`wall.js`](file:///Users/ryan/Sites/spindex/public/js/wall.js))
An endless, slowly rotating drifting wall of collection covers designed for display tablets:
- Calculates screen geometry and dynamically tiles album artwork edge-to-edge.
- Slowly rotates drift angle over a 12-minute cycle.
- Periodically raises a spotlighted cover into the screen center with title and artist typography.
- Uses the Screen Wake Lock API to prevent display sleep.

---

## 3. Data Storage and Schema

### Browser IndexedDB (`spindex_db`)
Managed by [`db.js`](file:///Users/ryan/Sites/spindex/public/js/db.js). Contains a single primary object store:
- **Store name**: `records`
- **Key**: `id` (string, formatted as `discogs_<release_id>` or `discogs_mock_<id>`)

Record Object Structure:
```javascript
{
  id: "discogs_1234567",
  discogsId: 1234567,
  instanceId: 987654321,
  title: "Album Title",
  artist: "Artist Name",
  year: 1978,                  // Pressing year from Discogs
  originalYear: 1973,          // Resolved original master release year
  genres: ["Rock", "Prog Rock"],
  styles: ["Art Rock"],
  formats: [                   // Raw Discogs format objects
    { name: "Vinyl", qty: "1", descriptions: ["LP", "Album", "Stereo", "Blue Translucent"] }
  ],
  tracklist: [
    { position: "A1", title: "Track Title", duration: "4:32" }
  ],
  coverArt: "https://...",     // Active display cover (high-res iTunes/Deezer or Discogs)
  discogsThumb: "https://...", // Original Discogs thumbnail
  backCoverArt: "https://...", // Cover Art Archive back cover URL
  rating: 0,
  notes: "Custom notes",
  dateAdded: "2024-03-15T12:00:00Z",
  condition: "Near Mint (NM or M-)",
  sleeveCondition: "Very Good Plus (VG+)"
}
```

### Browser LocalStorage Keys
- `spindex_sync_<username>`: JSON object storing synchronization metadata (`storedTotal`, `lastFullAt`, `lastCheckedAt`).
- `spindex_lyrics:<artist>|<title>`: In-memory and session cache for parsed song lyrics.
- `spindex_sort`: Active collection sort preference.
- `spindex_view`: Active browsing view (`stack`, `grid`, `list`).

---

## 4. Multi-Source Metadata Pipeline

The enrichment pipeline coordinates multiple public APIs:

```
                  +---------------------------+
                  |  Discogs API (via Proxy)  |
                  |  Collection, Masters, IDs |
                  +-------------+-------------+
                                |
                                v
               +----------------------------------+
               | IndexedDB (Local Primary Storage)|
               +----------------+-----------------+
                                |
      +-------------------------+-------------------------+
      |                         |                         |
      v                         v                         v
+-------------+         +---------------+         +---------------+
| iTunes &    |         | Wikipedia &   |         | MusicBrainz & |
| Deezer APIs |         | Wikidata APIs |         | Cover Art Arc |
| (High-Res   |         | (Liner Notes, |         | (Back Covers) |
| Cover Art)  |         | Bios, Credits)|         +---------------+
+------+------+         +-------+-------+                 |
       |                        |                         |
       +------------------------+-------------------------+
                                |
                                v
                  +---------------------------+
                  | LRCLIB API                |
                  | (Timed & Plain Lyrics)    |
                  +---------------------------+
```

### Data Pipeline Flow
1. **Initial Fast Ingestion** ([`sync.js`](file:///Users/ryan/Sites/spindex/public/js/sync.js)):
   - Fetches the user's collection releases newest-first from Discogs.
   - Batches master release IDs to Wikidata to resolve original release years prior to rendering the crate.
   - Immediately persists records to IndexedDB and renders the 3D crate stage.
2. **Progressive Background Enrichment**:
   - **Artwork Enrichment** ([`artwork.js`](file:///Users/ryan/Sites/spindex/public/js/artwork.js), [`imagematch.js`](file:///Users/ryan/Sites/spindex/public/js/imagematch.js)): Queries Deezer and iTunes for high-resolution sleeve replacements. Performs perceptual image hashing against the Discogs thumbnail to ensure accuracy before updating.
   - **Liner Notes & Personnel** ([`wiki.js`](file:///Users/ryan/Sites/spindex/public/js/wiki.js)): Queries Wikipedia REST endpoints and Wikidata SPARQL for album historical background, band biographies, and portrait photography.
   - **Back Cover Artwork** ([`wiki.js`](file:///Users/ryan/Sites/spindex/public/js/wiki.js)): Queries MusicBrainz release groups and the Cover Art Archive for back-of-sleeve scans.
   - **Lyrics on Demand** ([`lyrics.js`](file:///Users/ryan/Sites/spindex/public/js/lyrics.js)): When a user clicks a song in the album tracklist, queries LRCLIB using cleaned artist and title tokens, returning synchronized lines or plain text.
3. **Vinyl Pressing Simulation Engine** ([`vinyl.js`](file:///Users/ryan/Sites/spindex/public/js/vinyl.js)):
   - Parses Discogs format notes for keywords such as "Red", "Clear", "Splatter", "Marble", "Picture Disc".
   - Outputs visual CSS properties (base color, sheen, opacity, radial gradients, SVG filter masks) applied to the 3D vinyl record element.

---

## 5. Cloudflare Pages Functions & Edge Proxies

Located in [`functions/`](file:///Users/ryan/Sites/spindex/functions). Provides edge security, authentication, and caching:

### `/api/discogs/*`
- **OAuth 1.0a Negotiation** ([`login.js`](file:///Users/ryan/Sites/spindex/functions/api/discogs/login.js), [`callback.js`](file:///Users/ryan/Sites/spindex/functions/api/discogs/callback.js)): Performs the OAuth 1.0a handshake with Discogs. The application consumer secret is kept entirely server-side.
- **Encrypted Sessions** ([`session.js`](file:///Users/ryan/Sites/spindex/functions/api/discogs/session.js)): Issues an encrypted, HttpOnly session cookie containing the user's OAuth access token.
- **Authenticated Proxy & Cache** ([`[[path]].js`](file:///Users/ryan/Sites/spindex/functions/api/discogs/[[path]].js)): Validates the session cookie and proxies read-only Discogs requests. Responses for release, master, and artist records are cached using Cloudflare Edge Cache and an optional KV store (`DISCOGS_DATA`).

### `/api/ext` ([`ext.js`](file:///Users/ryan/Sites/spindex/functions/api/ext.js))
- Same-origin reverse proxy for external APIs: `en.wikipedia.org`, `www.wikidata.org`, `query.wikidata.org`, `commons.wikimedia.org`, `musicbrainz.org`, `coverartarchive.org`.
- Enforces strict hostname and path allowlists.
- Applies standard User-Agent headers required by MusicBrainz and Wikimedia.
- Caches responses at the edge with configurable TTLs (7 to 30 days).

### `/api/img` ([`img.js`](file:///Users/ryan/Sites/spindex/functions/api/img.js))
- Same-origin image proxy for `i.discogs.com`.
- Bypasses cross-origin canvas taint restrictions, allowing the browser to read image pixels for perceptual visual hashing ([`imagematch.js`](file:///Users/ryan/Sites/spindex/public/js/imagematch.js)).

### `/api/listen/deezer` ([`deezer.js`](file:///Users/ryan/Sites/spindex/functions/api/listen/deezer.js))
- Proxies album and track searches against Deezer's API to retrieve preview URLs and deep links.

### `/api/share/*` ([`functions/api/share/`](file:///Users/ryan/Sites/spindex/functions/api/share))
- **Publishing** (`POST /api/share`): Uploads a trimmed collection snapshot to Cloudflare KV (`SHARES`). Strips all personal notes, condition grades, and dates.
- **Retrieval** (`GET /api/share/:id`): Fetches the sanitized snapshot. Shared collections are loaded into an isolated client-side database partition.

---

## 6. Directory Structure

```
├── public/                    Static website and client application
│   ├── index.html             HTML5 shell, 3D crate stage, gatefold workspace, modals
│   ├── manifest.webmanifest   PWA manifest
│   ├── sw.js                  Service worker for offline caching
│   ├── css/
│   │   └── style.css          Complete styling, 3D perspective transforms, themes
│   └── js/
│       ├── app.js             Application orchestration, routing, view management
│       ├── artwork.js         Artwork resolution and high-resolution cover assignment
│       ├── browse.js          Cover grid and compact list browsing views
│       ├── crate.js           3D crate physics, touch gestures, wheel scrolling, keys
│       ├── db.js              IndexedDB database interface (`spindex_db`)
│       ├── discogs.js         Client Discogs authentication and proxy requests
│       ├── emptystate.js      Empty crate and search miss messaging
│       ├── external.js        Fetch wrapper for external sources via /api/ext
│       ├── filters.js         Filter drawer controls (decade, size, format, speed)
│       ├── health.js          Health check utilities
│       ├── imagematch.js      Perceptual canvas hashing for cover verification
│       ├── jobs.js            Background task scheduler
│       ├── limiter.js         Paced request queue with retry and backoff logic
│       ├── lyrics-drawer.js   Slide-out drawer UI for synchronized and plain lyrics
│       ├── lyrics.js          LRCLIB API client, query normalization, lyric parsing
│       ├── mock-data.js       Built-in 12-album starter crate
│       ├── notes.js           Album inspector, 3D flippable jacket, vinyl disc preview
│       ├── search.js          Client-side collection search filtering
│       ├── share.js           Read-only crate publishing and snapshot loading
│       ├── sourcestats.js     Source reliability and lookup success tracking
│       ├── stats.js           Collection metrics, runtimes, and curiosity computations
│       ├── statsview.js       Sleeve-style statistics dashboard, shelf spines, charts
│       ├── sync.js            Discogs sync engine, enrichment pipeline, credits
│       ├── syncplan.js        Incremental sync planner and change detection
│       ├── updates.js         Service worker update notifications
│       ├── values.js          Value formatting helpers and custom release detection
│       ├── vinyl.js           Format note parser for realistic vinyl color simulation
│       ├── wall.js            Ambient screensaver cover wall with rotating drift
│       ├── welcome.js         First-run onboarding dialog and sync progress
│       ├── wiki.js            Wikipedia, Wikidata, and MusicBrainz integration
│       └── years.js           Original release year reconciliation logic
├── functions/                 Cloudflare Pages Functions
│   ├── _lib/                  Shared server modules (OAuth, crypto, cookies, cache)
│   └── api/
│       ├── discogs/           Discogs OAuth authentication and cached proxy
│       ├── ext.js             Allowlisted caching proxy for external music data
│       ├── health.js          Backend configuration and health status endpoint
│       ├── img.js             Cross-origin image proxy for thumbnail comparison
│       ├── listen/deezer.js   Deezer album search and preview link proxy
│       └── share/             KV snapshot publishing and retrieval endpoints
├── tests/                     Automated test suite
│   ├── basic-test.js          Core integration, demo crate, and format checks
│   ├── cache-test.mjs         Edge caching rules and TTL verification
│   ├── ext-test.mjs           External proxy host allowlist security tests
│   ├── logic-test.mjs         Business logic, sync planning, stats, and search tests
│   ├── oauth-test.mjs         End-to-end OAuth flow against mock Discogs server
│   ├── share-test.mjs         Share publishing, snapshot sanitization, and KV retrieval
│   ├── sw-test.mjs            Service worker routing and cache handling
│   ├── syntax-test.mjs        Syntax validation across all JavaScript modules
│   └── vinyl-test.mjs         Vinyl format parser and color classification tests
├── wrangler.toml              Cloudflare Pages and KV namespace configuration
├── package.json               Project configuration and test scripts
└── .dev.vars.example          Template for local development secrets
```

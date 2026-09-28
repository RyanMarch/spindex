# Spindex

Spindex lets you browse your vinyl record collection just like flipping through records in a crate. It connects to your Discogs library and shows you new ways to explore your music.

---

## User Features and Benefits

### Crate Digging
- **Physical crate experience**: Flip through your vinyl jackets in a realistic 3D perspective with authentic depth, shadows, and inertia.
- **Natural controls**: Navigate using touch swipe gestures on phones and tablets, mouse wheel and trackpad gestures on desktops, arrow keys, or direct letter keys (A to Z) to jump directly to an artist.
- **Dynamic backdrop glow**: Enjoy beautiful color-matched backdrops while you browse.

### Flexible Browsing Views
- **Stack view**: The default stack for flipping through your records one by one.
- **Grid view**: A poster-style grid to see dozens of album covers simultaneously.
- **List view**: A compact table view showing artist, title, release year, format, and catalog details.
- **Quick view switching**: Switch between views at any time or with keyboard shortcuts (`1`, `2`, `3`).

### Instant Search and Deep Filtering
- **Quick search**: Press `/` from anywhere to search your collection by album title, artist, or song name.
- **Browse drawer**: Records are organized under genres derived directly from your collection tags.
- **Multi-criteria filters**: Narrow your crate by decade, record size (12", 7", 10"), pressing type, disc count, and playback speed (33 RPM, 45 RPM).
- **Jump rail**: Quickly scrub through alphabetical letters or decades along the screen edge.
- **Surprise me**: Jump to a random record when you want your crate to choose your next spin.

### Interactive Album Sleeve and Vinyl Simulation
- **Full album details**: Open any record (`/album/<artist>/<title>/`) to view more information, tracklists, and artwork.
- **Flippable jacket**: Flip between the front jacket and the back cover.
- **Pressing-accurate vinyl disc**: Pull the record out of its sleeve to see it in the actual color and texture of your pressing, including standard black, clear, colored, marbled, splatter, swirl, split, or picture disc designs.

### Tracklists and Synchronized Lyrics
- **Track-by-track details**: Complete track listings with individual song runtimes and side indicators.
- **Slide-over lyrics drawer**: Click any track to view lyrics (where available).

### Liner Notes, Personnel, and Artist Biographies
- **Liner notes**: Read background stories, recording histories, and personnel credits gathered from Wikipedia and Wikidata, formatted with clean typography.
- **Artist profiles**: Dedicated sections with artist portrait photography and career biographies.
- **Crate connections**: Discover related albums elsewhere in your collection by the same artist or within shared genres.

### Your Copy and Collection Notes
- **Condition grading**: View your copy's media and sleeve condition grades directly from your Discogs catalog.
- **Dates**: Keep track of when an album was added to your collection.
- **Artwork comparison and verification**: Spindex checks for high-resolution cover replacements from iTunes and Deezer. You can inspect the suggested art against the Discogs thumbnail and revert if you prefer the original.

### Audio Previews and Video
- **Streaming links**: Direct links to open albums in Apple Music or Deezer.
- **Music videos**: Watch music videos associated with each album.

### Collection Statistics and Fun Facts
- **Collection dashboard**: Open the stats view to see total record counts, unique artists, and total listening time.
- **Decade shelf**: A row of record spines displaying how your collection spans across musical eras.
- **Pressing color palette**: A breakdown of vinyl variants across your shelf.
- **Collection growth line**: An interactive timeline charting your cataloging history across months and years.
- **Curiosity standouts and fun facts**: Four random facts picked on each visit, highlighting milestones such as your first logged record, latest addition, biggest single-day haul, favorite cataloging days, quickest spins, longest tracks, self-titled releases, and single-record artists.

### Ambient Screensaver Wall Mode
- **Turn your display into art**: Designed for tablets on stands or wall-mounted screens (`4` key, `/?wall`, or Settings > Screensaver).
- **Drifting mosaic**: An endless wall of covers that slowly drift around the screen.
- **Cover spotlights**: Every few seconds an album lifts forward into the center of the screen with its artist and title.
- **Screen Wake Lock**: Keeps your screen illuminated while active, and clicking any spotlighted cover opens its album page.

### Private Collection Sharing
- **Collection share links**: Generate a share link (`/s/<id>`) to show your collection to friends without creating an account.
- **Privacy safe**: Shared links never expose private notes, purchase dates, condition grades, or personal information.
- **Revoke at any time**: You can update or disable the share link at any time from Settings.

### Offline-First Reliability
- **Works without an internet connection**: Your entire crate is stored in local browser storage. Once loaded, you can browse, filter, search, and view album pages completely offline.
- **Instant startup**: No waiting on slow remote databases when opening the app.
- **Built-in demo crate**: First-time visitors can explore an immediate 12-album sample collection before connecting their Discogs account. Add `?demo` to test the demo crate at any time.

---

## Technical Overview

Spindex is architected as a local-first web application designed for fast, offline-capable browsing:

- **Frontend Foundation**: Built with standard HTML5, CSS custom properties, and native ES modules without build tools, bundlers, or client frameworks.
- **Local-First Storage**: The user's entire collection is synchronized into browser IndexedDB (`spindex_db`). Once loaded, searching, sorting, filtering, and album inspection run locally without network latency.
- **Multi-Source Data Aggregation**: Core releases and pressings originate from Discogs, enriched with high-resolution artwork from iTunes and Deezer, liner notes and artist biographies from Wikipedia and Wikidata, back covers from MusicBrainz and Cover Art Archive, and song lyrics from LRCLIB.
- **Serverless Edge Layer**: Cloudflare Pages Functions handle secure OAuth authentication with Discogs, proxy external music APIs to resolve CORS requirements, and cache responses at the edge.
- **Offline PWA Support**: A network-first Service Worker (`sw.js`) caches application assets for offline playback and handles background update checks.

For detailed architecture diagrams, data schemas, enrichment pipelines, edge proxy specifications, and file layouts, see the [Technical Architecture Guide](file:///Users/ryan/Sites/spindex/TECHNICAL.md).

---

## Keyboard Shortcuts

Press `?` anywhere in the app to view the keyboard shortcut reference:

| Key | Action |
| --- | --- |
| `↑` `↓` `←` `→` | Move through the crate |
| `Enter` | Open the selected record sleeve |
| `A` to `Z` | Jump directly to that letter in the crate |
| `/` | Focus search input |
| `1` | Switch to Stack (3D Crate) view |
| `2` | Switch to Grid view |
| `3` | Switch to List view |
| `4` | Launch Screensaver Wall mode |
| `Esc` | Close active dialog, drawer, or album page |
| `?` | Show keyboard shortcuts |


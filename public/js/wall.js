// wall.js - the screensaver. Every cover in the crate tiled edge to edge, drifting very slowly, in a direction that
// itself turns slowly over time. Every so often one lifts out of the wall, floats to the middle with its title, and
// settles back. For tablets and larger; a phone is too small for it to be worth doing.
//
// The wall is endless: tiles are recycled from the side they leave to the side they are heading for, and what a tile
// shows depends only on where it is in the wall, so the heading can point anywhere.
import { crateArtUrl } from './crate.js';
import { smallArtUrl } from './browse.js';

export const SPOT_HOLD_MS = 8000;
export const SPOT_RISE_MS = 1500;
export const SPOT_FALL_MS = 1200;
export const SPOT_GAP_MS = 8500;
export const RECENT_SPOTS = 8;

// Big enough to be worth showing: a phone (in either direction) is not
export const wallSupported = (width, height) => Math.min(width, height) >= 600;

// How big the tiles are and how many it takes to cover the screen. It aims to show about one tile per record, but never so
// small that a cover is mush, nor so large that the wall stops feeling like a wall. Two extra tiles in each direction mean
// there is always one waiting just off the edge that the drift is heading towards.
export function planWall({ width, height, count, minTile = 110, maxTile = 230 }) {
  const wanted = Math.sqrt((width * height) / Math.max(count, 1));
  const tile = Math.round(Math.min(maxTile, Math.max(minTile, wanted)));
  const cols = Math.ceil(width / tile) + 2;
  const rows = Math.ceil(height / tile) + 2;
  return { tile, cols, rows, cells: cols * rows, speed: Math.max(3, tile * 0.026) };
}

const mod = (a, n) => ((a % n) + n) % n;

// Which record sits at column c, row r of the endless wall. Along a row the collection simply runs on, so every record
// appears once before any repeats; each row starts a good way further along (with a small, repeating irregularity) so the
// pattern doesn't line up into stripes. The same record never sits beside itself, above or below.
export function wallPattern(records, rand = Math.random) {
  const pool = records.filter(Boolean);
  const n = pool.length;
  const order = [...pool];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const step = n <= 2 ? 1 : Math.max(2, Math.round(n * 0.382));
  const wobble = (r) => (n >= 6 ? ((mod(r, 5) * 7) % 5 < 2 ? 1 : 0) : 0);
  return (c, r) => (n === 0 ? null : order[mod(c + r * step + wobble(r), n)]);
}

// The direction of travel, in radians, t seconds in. It turns steadily (a full circle takes about twelve minutes) with a
// gentle sway on top, so the path curves rather than sweeping round in a perfect circle, and now and then eases back
// the other way.
export function headingAt(t, { start = 0, turnsPerSecond = 1 / 720 } = {}) {
  return start + 2 * Math.PI * turnsPerSecond * t + 0.4 * Math.sin(t / 41);
}

// A tile that has gone completely off one side is moved to the far side, ahead of the drift. Returns its new column
// (or row, the maths is the same): tile is the tile size, origin how far the wall has travelled, extent the screen size.
export function recycled(index, tile, origin, extent, count) {
  const start = index * tile - origin;
  if (start < -tile) return index + count;
  if (start > extent) return index - count;
  return index;
}

// The square the chosen cover grows to: large, but always leaving room beneath for the title
export function spotSize(width, height) {
  return Math.round(Math.max(200, Math.min(height * 0.58, width * 0.5, 620)));
}

// Which tile lifts next: one that is well inside the screen (not half off an edge), and not one of the last few shown
export function pickSpot(rects, recent, { width, height }, rand = Math.random) {
  const inside = rects
    .map((r, index) => ({ index, r }))
    .filter(({ r }) => r && r.left > width * 0.06 && r.right < width * 0.94 && r.top > height * 0.06 && r.bottom < height * 0.94);
  const fresh = inside.filter(({ index }) => !recent.includes(index));
  const pool = fresh.length ? fresh : inside;
  return pool.length ? pool[Math.floor(rand() * pool.length)].index : -1;
}

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

export class Wall {
  // getRecords() -> the records to show; onOpen(record) when the raised cover is tapped
  constructor({ root, getRecords, onOpen }) {
    this.root = root;
    this.getRecords = getRecords;
    this.onOpen = onOpen;
    this.active = false;
    this.timer = null;
    this.recent = [];
    this.spot = null;
    this.wakeLock = null;
  }

  get isActive() {
    return this.active;
  }

  start() {
    if (this.active) return;
    const records = (this.getRecords() || []).filter((r) => r?.artwork?.highRes || r?.artwork?.thumbnail);
    if (records.length === 0) return;
    this.records = records;
    this.pattern = null;
    this.world = null;
    this.active = true;
    this.startedAt = Date.now();
    this.build();
    this.root.hidden = false;
    requestAnimationFrame(() => this.root.classList.add('is-on'));
    this.bind();
    this.hideCursorSoon();
    this.schedule(2500);
    // Neither of these may hold anything up: a browser can refuse, or never answer
    try { document.documentElement.requestFullscreen?.()?.catch(() => { }); } catch { /* the wall still works without it */ }
    try { navigator.wakeLock?.request('screen').then((lock) => { this.wakeLock = lock; }).catch(() => { }); } catch { /* the screen may sleep: fine */ }
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this.timer);
    clearTimeout(this.cursorTimer);
    cancelAnimationFrame(this.raf);
    this.unbind();
    this.spot?.remove();
    this.caption?.remove();
    this.spot = this.caption = this.spotTile = null;
    this.root.classList.remove('is-on', 'is-spot');
    setTimeout(() => { if (!this.active) { this.root.hidden = true; this.root.replaceChildren(); } }, 650);
    try { this.wakeLock?.release?.(); } catch { /* fine */ }
    this.wakeLock = null;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => { });
  }

  build() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const plan = planWall({ width, height, count: this.records.length });
    this.plan = plan;
    if (!this.pattern) this.pattern = wallPattern(this.records);
    // Where in the endless wall the screen is looking, and which way it is heading to begin with
    if (!this.world) {
      this.world = { x: Math.random() * plan.tile * this.records.length, y: Math.random() * plan.tile * 12 };
      this.heading = { start: Math.random() * Math.PI * 2, t: 0, sign: Math.random() < 0.5 ? 1 : -1 };
    }
    const baseCol = Math.floor(this.world.x / plan.tile) - 1;
    const baseRow = Math.floor(this.world.y / plan.tile) - 1;
    const grid = document.createElement('div');
    grid.className = 'wall-grid';
    grid.style.setProperty('--tile', `${plan.tile}px`);
    this.tiles = [];
    for (let j = 0; j < plan.rows; j++) {
      for (let i = 0; i < plan.cols; i++) {
        const tile = document.createElement('div');
        tile.className = 'wall-tile';
        const img = document.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        img.onerror = () => { img.style.visibility = 'hidden'; };
        tile.append(img);
        grid.append(tile);
        const t = { el: tile, img, c: baseCol + i, r: baseRow + j, record: null, placed: false };
        this.tiles.push(t);
        this.place(t);
      }
    }
    const hint = document.createElement('p');
    hint.className = 'wall-hint';
    hint.textContent = 'Click or press any key to leave';
    this.root.replaceChildren(grid, hint);
    this.grid = grid;
    this.move();
    setTimeout(() => hint.classList.add('is-gone'), 4500);
    if (!reduced()) this.startDrift();
  }

  // Put a tile where its column and row say, showing what belongs there
  place(t) {
    const record = this.pattern(t.c, t.r);
    if (record !== t.record) {
      t.record = record;
      t.img.style.visibility = '';
      t.img.src = smallArtUrl(record, 300);
    }
    // A little variety in how bright each one sits, fixed by where it is so it doesn't change as the wall moves
    t.el.style.setProperty('--o', (0.52 + (Math.abs(t.c * 37 + t.r * 61) % 23) / 100).toFixed(2));
    t.el.style.transform = `translate3d(${t.c * this.plan.tile}px, ${t.r * this.plan.tile}px, 0)`;
  }

  // The whole wall is one layer, moved as one; tiles only change when they leave the screen
  move() {
    this.grid.style.transform = `translate3d(${-this.world.x.toFixed(2)}px, ${-this.world.y.toFixed(2)}px, 0)`;
  }

  startDrift() {
    cancelAnimationFrame(this.raf);
    let last = null;
    const tick = (now) => {
      if (!this.active) return;
      const dt = last === null ? 0 : Math.min((now - last) / 1000, 0.1);
      last = now;
      this.heading.t += dt;
      const angle = headingAt(this.heading.t * this.heading.sign, { start: this.heading.start });
      this.world.x += Math.cos(angle) * this.plan.speed * dt;
      this.world.y += Math.sin(angle) * this.plan.speed * dt;
      this.move();
      this.recycle();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  recycle() {
    const { tile, cols, rows } = this.plan;
    const width = window.innerWidth;
    const height = window.innerHeight;
    for (const t of this.tiles) {
      if (this.spotTile === t) continue; // the one being looked at stays where it is
      const c = recycled(t.c, tile, this.world.x, width, cols);
      const r = recycled(t.r, tile, this.world.y, height, rows);
      if (c !== t.c || r !== t.r) {
        t.c = c;
        t.r = r;
        this.place(t);
      }
    }
  }

  // ---- leaving ----

  bind() {
    this.onDown = (e) => {
      if (Date.now() - this.startedAt < 700) return; // the click that started it
      const raised = this.spot && e.target.closest?.('.wall-spot, .wall-caption');
      if (raised && this.spotRecord) {
        const record = this.spotRecord;
        this.stop();
        this.onOpen?.(record);
      } else {
        this.stop();
      }
    };
    this.onKey = (e) => {
      if (Date.now() - this.startedAt < 700) return;
      e.preventDefault();
      e.stopPropagation();
      this.stop();
    };
    this.onMove = () => {
      this.root.classList.remove('is-still');
      this.hideCursorSoon();
    };
    this.onHide = () => {
      if (document.visibilityState === 'hidden') clearTimeout(this.timer);
      else if (this.active) {
        this.schedule(1500);
        navigator.wakeLock?.request('screen').then((l) => { this.wakeLock = l; }).catch(() => { });
      }
    };
    this.onFullscreen = () => {
      // Leaving fullscreen (Esc, or the swipe on an iPad) ends the screensaver too
      if (this.active && !document.fullscreenElement && Date.now() - this.startedAt > 1500 && this.wentFullscreen) this.stop();
      if (document.fullscreenElement) this.wentFullscreen = true;
    };
    this.onResize = () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => { if (this.active && !this.spot) { this.pattern = this.pattern || null; this.build(); } }, 400);
    };
    window.addEventListener('pointerdown', this.onDown, true);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('pointermove', this.onMove, { passive: true });
    document.addEventListener('visibilitychange', this.onHide);
    document.addEventListener('fullscreenchange', this.onFullscreen);
    window.addEventListener('resize', this.onResize);
  }

  unbind() {
    window.removeEventListener('pointerdown', this.onDown, true);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('pointermove', this.onMove);
    document.removeEventListener('visibilitychange', this.onHide);
    document.removeEventListener('fullscreenchange', this.onFullscreen);
    window.removeEventListener('resize', this.onResize);
    this.wentFullscreen = false;
  }

  hideCursorSoon() {
    clearTimeout(this.cursorTimer);
    this.cursorTimer = setTimeout(() => this.root.classList.add('is-still'), 2500);
  }

  // ---- the raised cover ----

  schedule(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.raise(), delay);
  }

  async raise() {
    if (!this.active || document.visibilityState === 'hidden') return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const rects = this.tiles.map((t) => t.el.getBoundingClientRect());
    const index = pickSpot(rects, this.recent, { width, height });
    if (index === -1) { this.schedule(3000); return; }
    this.recent = [...this.recent, index].slice(-RECENT_SPOTS);
    const tile = this.tiles[index];
    const from = rects[index];

    // Wait (briefly) for the large picture, so the cover doesn't sharpen while it is being looked at
    const big = new Image();
    big.src = crateArtUrl(tile.record) || tile.img.src;
    await Promise.race([big.decode().catch(() => { }), new Promise((r) => setTimeout(r, 1500))]);
    if (!this.active) return;

    const size = spotSize(width, height);
    const cx = width / 2;
    const cy = height / 2 - Math.min(40, height * 0.04);
    const spot = document.createElement('figure');
    spot.className = 'wall-spot';
    spot.style.cssText = `width:${size}px;height:${size}px;left:${Math.round(cx - size / 2)}px;top:${Math.round(cy - size / 2)}px;`;
    const img = document.createElement('img');
    img.alt = '';
    img.src = big.complete && big.naturalWidth ? big.src : tile.img.src;
    spot.append(img);

    const caption = document.createElement('div');
    caption.className = 'wall-caption';
    caption.style.top = `${Math.round(cy + size / 2 + 22)}px`;
    const title = document.createElement('strong');
    title.textContent = tile.record.title || '';
    const artist = document.createElement('span');
    artist.textContent = tile.record.artist || '';
    const meta = document.createElement('em');
    meta.textContent = [tile.record.masterYear || tile.record.year, (tile.record.genres || [])[0]].filter(Boolean).join(' · ');
    caption.append(title, artist, meta);

    this.root.append(spot, caption);
    this.spot = spot;
    this.caption = caption;
    this.spotRecord = tile.record;
    this.root.classList.add('is-spot');
    tile.el.style.visibility = 'hidden';
    this.spotTile = tile;

    if (reduced()) {
      await spot.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, fill: 'both' }).finished.catch(() => { });
    } else {
      const dx = from.left + from.width / 2 - cx;
      const dy = from.top + from.height / 2 - cy;
      const scale = from.width / size;
      await spot.animate(
        [{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: 'none' }],
        { duration: SPOT_RISE_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' },
      ).finished.catch(() => { });
    }
    if (!this.active) return;
    caption.classList.add('is-in');
    await new Promise((r) => { this.holdTimer = setTimeout(r, SPOT_HOLD_MS); });
    if (!this.active) return;
    await this.lower(tile, spot, caption, cx, cy, size);
    if (this.active) this.schedule(SPOT_GAP_MS);
  }

  // Back into the wall, to wherever that tile has drifted to by now
  async lower(tile, spot, caption, cx, cy, size) {
    caption.classList.remove('is-in');
    const to = tile.el.getBoundingClientRect();
    if (reduced()) {
      await spot.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, fill: 'both' }).finished.catch(() => { });
    } else {
      const dx = to.left + to.width / 2 - cx;
      const dy = to.top + to.height / 2 - cy;
      await spot.animate(
        [{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${to.width / size})` }],
        { duration: SPOT_FALL_MS, easing: 'cubic-bezier(0.5, 0, 0.2, 1)', fill: 'both' },
      ).finished.catch(() => { });
    }
    tile.el.style.visibility = '';
    if (this.spotTile === tile) this.spotTile = null;
    spot.remove();
    caption.remove();
    if (this.spot === spot) this.spot = this.caption = this.spotRecord = null;
    this.root.classList.remove('is-spot');
  }
}

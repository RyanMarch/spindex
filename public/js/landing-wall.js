// landing-wall.js - the screensaver, shown inside a box on the home page.
// It is the real wall (wall.js) at a smaller size: the same endless grid that drifts as one layer in a slowly turning
// direction, the same pattern, the same recycling, and the same spotlight that lifts a cover to the middle with its
// title. All of that comes from wall.js's own functions and timings, so the two cannot drift apart; this file only
// swaps the things that belong to a full-screen takeover (fullscreen, wake lock, leaving on any key) for a box that
// starts and stops with the page scrolling past it.
import {
  planWall, wallPattern, headingAt, recycled, pickSpot, spotSize,
  SPOT_HOLD_MS, SPOT_RISE_MS, SPOT_FALL_MS, SPOT_GAP_MS, RECENT_SPOTS,
} from './wall.js';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export class LandingWall {
  // host: the box. records: what to show. art(record, size): a cover's URL. getFree(): the part of the box (in its own
  // pixels) that nothing is laid over, where the raised cover may go, or null to keep it down. onOpen(record): a tap
  // on the raised cover.
  constructor({ host, records, art, getFree, onOpen }) {
    this.host = host;
    this.records = records.filter((r) => r?.artwork?.highRes || r?.artwork?.thumbnail);
    this.art = art;
    this.getFree = getFree;
    this.onOpen = onOpen;
    this.active = false;
    this.recent = [];
    this.spot = null;
    this.pattern = wallPattern(this.records);
  }

  start() {
    if (this.active || !this.records.length) return;
    this.active = true;
    this.build();
    this.resizeObserver = new ResizeObserver(() => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => { if (this.active && !this.spot) this.build(); }, 300);
    });
    this.resizeObserver.observe(this.host);
    this.schedule(2500);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this.timer);
    clearTimeout(this.resizeTimer);
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.spot?.remove();
    this.caption?.remove();
    this.spot = this.caption = this.spotTile = this.spotRecord = null;
    this.host.classList.remove('is-spot');
  }

  build() {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!width || !height) return;
    cancelAnimationFrame(this.raf);
    const plan = planWall({ width, height, count: this.records.length });
    this.plan = plan;
    // Where in the endless wall the box is looking, and which way it is heading to begin with
    if (!this.world) {
      this.world = { x: Math.random() * plan.tile * this.records.length, y: Math.random() * plan.tile * 12 };
      this.heading = { start: Math.random() * Math.PI * 2, t: 0, sign: Math.random() < 0.5 ? 1 : -1 };
    }
    const baseCol = Math.floor(this.world.x / plan.tile) - 1;
    const baseRow = Math.floor(this.world.y / plan.tile) - 1;

    const grid = document.createElement('div');
    grid.className = 'lw-grid';
    grid.style.setProperty('--tile', `${plan.tile}px`);
    this.tiles = [];
    for (let j = 0; j < plan.rows; j++) {
      for (let i = 0; i < plan.cols; i++) {
        const el = document.createElement('div');
        el.className = 'lw-tile';
        const img = document.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        el.append(img);
        grid.append(el);
        const t = { el, img, c: baseCol + i, r: baseRow + j, record: null };
        this.tiles.push(t);
        this.place(t);
      }
    }
    this.host.replaceChildren(grid);
    this.grid = grid;
    this.move();
    if (!reduced()) this.drift();
  }

  // Put a tile where its column and row say, showing what belongs there
  place(t) {
    const record = this.pattern(t.c, t.r);
    if (record !== t.record) {
      t.record = record;
      t.img.src = this.art(record, 300);
    }
    // A little variety in how bright each one sits, fixed by where it is so it doesn't change as the wall moves
    t.el.style.setProperty('--o', (0.52 + (Math.abs(t.c * 37 + t.r * 61) % 23) / 100).toFixed(2));
    t.el.style.transform = `translate3d(${t.c * this.plan.tile}px, ${t.r * this.plan.tile}px, 0)`;
  }

  // The whole wall is one layer, moved as one; tiles only change when they leave the box
  move() {
    this.grid.style.transform = `translate3d(${-this.world.x.toFixed(2)}px, ${-this.world.y.toFixed(2)}px, 0)`;
  }

  drift() {
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
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
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

  // ---- the raised cover (wall.js's raise and lower, placed in the free part of the box) ----

  schedule(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.raise(), delay);
  }

  async raise() {
    if (!this.active) return;
    const free = this.getFree?.();
    if (!free) { this.schedule(3000); return; }
    const box = this.host.getBoundingClientRect();
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;

    // Only a tile inside the free part may lift, so nothing rises from behind the copy
    const rects = this.tiles.map((t) => {
      const r = t.el.getBoundingClientRect();
      const inFree = r.left - box.left >= free.left && r.right - box.left <= free.left + free.width;
      return inFree ? { left: r.left - box.left, right: r.right - box.left, top: r.top - box.top, bottom: r.bottom - box.top, width: r.width, height: r.height } : null;
    });
    const index = pickSpot(rects, this.recent, { width: free.left + free.width, height });
    if (index === -1) { this.schedule(3000); return; }
    this.recent = [...this.recent, index].slice(-RECENT_SPOTS);
    const tile = this.tiles[index];
    const from = rects[index];

    // Wait (briefly) for the large picture, so the cover doesn't sharpen while it is being looked at
    const big = new Image();
    big.src = this.art(tile.record, 600);
    await Promise.race([big.decode().catch(() => { }), new Promise((r) => setTimeout(r, 1500))]);
    if (!this.active) return;

    const size = spotSize(free.width, height);
    const cx = free.left + free.width / 2;
    const cy = height / 2 - Math.min(40, height * 0.04);
    const spot = document.createElement('figure');
    spot.className = 'lw-spot';
    spot.style.cssText = `width:${size}px;height:${size}px;left:${Math.round(cx - size / 2)}px;top:${Math.round(cy - size / 2)}px;`;
    const img = document.createElement('img');
    img.alt = '';
    img.src = big.complete && big.naturalWidth ? big.src : tile.img.src;
    spot.append(img);
    spot.addEventListener('click', () => { if (this.spotRecord) this.onOpen?.(this.spotRecord); });

    const caption = document.createElement('div');
    caption.className = 'lw-caption';
    caption.style.cssText = `top:${Math.round(cy + size / 2 + 22)}px;left:${Math.round(free.left)}px;width:${Math.round(free.width)}px;`;
    const title = document.createElement('strong');
    title.textContent = tile.record.title || '';
    const artist = document.createElement('span');
    artist.textContent = tile.record.artist || '';
    const meta = document.createElement('em');
    meta.textContent = [tile.record.masterYear || tile.record.year, (tile.record.genres || [])[0]].filter(Boolean).join(' · ');
    caption.append(title, artist, meta);

    this.host.append(spot, caption);
    this.spot = spot;
    this.caption = caption;
    this.spotRecord = tile.record;
    this.host.classList.add('is-spot');
    tile.el.style.visibility = 'hidden';
    this.spotTile = tile;

    if (reduced()) {
      await spot.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, fill: 'both' }).finished.catch(() => { });
    } else {
      const dx = from.left + from.width / 2 - cx;
      const dy = from.top + from.height / 2 - cy;
      await spot.animate(
        [{ transform: `translate(${dx}px, ${dy}px) scale(${from.width / size})` }, { transform: 'none' }],
        { duration: SPOT_RISE_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' },
      ).finished.catch(() => { });
    }
    if (!this.active) return;
    caption.classList.add('is-in');
    await new Promise((r) => { this.holdTimer = setTimeout(r, SPOT_HOLD_MS); });
    if (!this.active) return;
    await this.lower(tile, spot, caption, cx, cy, size, box);
    if (this.active) this.schedule(SPOT_GAP_MS);
  }

  // Back into the wall, to wherever that tile has drifted to by now
  async lower(tile, spot, caption, cx, cy, size, box) {
    caption.classList.remove('is-in');
    const r = tile.el.getBoundingClientRect();
    const to = { left: r.left - box.left, top: r.top - box.top, width: r.width, height: r.height };
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
    this.host.classList.remove('is-spot');
  }
}

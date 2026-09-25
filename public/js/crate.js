// crate.js - Vertical 3D Cover Flow with persistent element animations
import { parseSortArtist } from './sync.js';

// The stack shows covers at about 300 to 500 points wide, so 600px art is plenty; the album page keeps the 1200px version.
// (Decoding 1200px art for every sleeve is what makes flipping through a big crate heavy on a phone.)
export function crateArtUrl(record) {
  const url = record.artwork?.highRes || record.artwork?.thumbnail || '';
  return url.replace('1200x1200bb', '600x600bb').replace('/1000x1000-', '/500x500-');
}

export class CrateController {
  constructor(containerEl, counterEl, onSelectRecord, onIndexChange, onScrub) {
    this.container = containerEl;
    this.counter = counterEl;
    this.onSelect = onSelectRecord;
    this.onIndexChange = onIndexChange;
    this.onScrub = onScrub; // (index, fade): which record is nearest the front, and how settled the stack is (1 = at rest)
    this.speed = 0; // albums per second, smoothed
    this.lastPos = 0;
    this.lastRenderT = 0;
    this.scrubIndex = -1;
    this.scrubFade = -1;
    this.records = [];
    this.sleeveElements = [];
    this.currentIndex = 0;
    // How far the stack reaches on screen, set in measure(): albums beyond it aren't drawn at all
    this.visibleAbove = 12;
    this.visibleBelow = 45;
    this.sortKey = 'artist';
    this.pos = 0;
    this.vel = 0;
    this.raf = null;
    this.lastT = 0;
    this.size = 420;
    this.canHover = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches);
    this.gap = 0; // Extra space opened between the active album and the lower stack (compact layout hosts title/artist there)
    this.compactMq = typeof window !== 'undefined' ? window.matchMedia?.('(max-width: 960px)') : null;
    this.reducedMotion = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches : false;

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => {
        this.measure();
        this.render();
      });

      this.bindEvents();
    }
  }

  getStackStep(k) {
    if (k <= 0) return 0;
    if (k === 1) return 1.0;
    if (k === 2) return 1.85;
    if (k === 3) return 2.55;
    return 2.55 + 2.2 * (1 - Math.pow(0.75, k - 3));
  }

  getBelowYStep(k) {
    if (k <= 0) return 0;
    if (k === 1) return 1.0;
    if (k === 2) return 1.9;
    return 2.75 + 0.85 * (k - 3);
  }

  setRecords(records, sortKey = 'artist', targetRecordId = null) {
    const previousActiveId = targetRecordId || this.records[this.currentIndex]?.id || null;
    this.records = records || [];
    this.sortKey = sortKey;

    let targetIndex = 0;
    if (previousActiveId) {
      const foundIndex = this.records.findIndex((r) => r.id === previousActiveId);
      if (foundIndex !== -1) {
        targetIndex = foundIndex;
      }
    }
    this.currentIndex = targetIndex;
    this.buildSleeves();
  }

  // Same records in the same order with fresher data: nothing moves, only artwork that changed is swapped
  refreshRecords(records) {
    if (records.length !== this.records.length) return;
    this.records = records;
    this.sleeveElements.forEach((item, i) => {
      item.record = records[i];
      const url = crateArtUrl(records[i]);
      if (item.img && item.img.getAttribute('src') !== url) item.img.src = url;
    });
  }

  setIndex(index) {
    if (index >= 0 && index < this.records.length && index !== this.currentIndex) {
      this.currentIndex = index;
      this.updatePositions();
    }
  }

  buildSleeves() {
    if (typeof document === 'undefined') return;
    this.container.innerHTML =  /*html*/ '';
    this.sleeveElements = [];
    const total = this.records.length;

    if (total === 0) {
      if (this.counter) this.counter.textContent = '0 / 0';
      if (this.onIndexChange) this.onIndexChange(0, 0, null);
      return;
    }

    // Build persistent sleeve DOM elements once so CSS transitions can animate between positions
    for (let i = 0; i < total; i++) {
      const record = this.records[i];
      const el = document.createElement('div');
      el.className = 'sleeve';
      el.dataset.index = String(i);
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${record.title} by ${record.artist}`);
      el.tabIndex = -1;

      // Solid jacket cover wrapper
      const coverWrap = document.createElement('div');
      coverWrap.className = 'sleeve-cover-wrap';

      // Cover artwork image
      const img = document.createElement('img');
      img.src = crateArtUrl(record);
      img.alt = `${record.artist} - ${record.title}`;
      img.loading = i <= 3 ? 'eager' : 'lazy';
      img.decoding = 'async'; // decoding a cover never holds up a frame of the stack

      img.onerror = () => {
        img.style.display = 'none';
        const fallback = document.createElement('div');
        fallback.className = 'cover-fallback';
        fallback.innerHTML =  /*html*/ `<div class="fallback-artist">${this.escapeHTML(record.artist)}</div><div class="fallback-title">${this.escapeHTML(record.title)}</div>`;
        coverWrap.appendChild(fallback);
      };

      coverWrap.appendChild(img);

      // Dynamic surface sheen
      const sheen = document.createElement('div');
      sheen.className = 'sleeve-sheen-overlay';
      coverWrap.appendChild(sheen);

      // Depth shading: a black veil whose opacity changes (cheap to animate), in place of a per-frame brightness filter
      const dim = document.createElement('div');
      dim.className = 'sleeve-dim';

      // What lifts the front album off the stack: its deep shadow and its shine. They are layers whose opacity follows
      // the album's distance from the front, so they fade in and out with the scroll instead of switching at a halfway point.
      const lift = document.createElement('div');
      lift.className = 'sleeve-lift';
      const frontSheen = document.createElement('div');
      frontSheen.className = 'sleeve-sheen-front';
      coverWrap.append(frontSheen, dim);

      // The jacket's thickness: a bevelled edge and a lit top lip just outside the artwork, never over it
      const edge = document.createElement('div');
      edge.className = 'sleeve-edge';

      const lip = document.createElement('div');
      lip.className = 'sleeve-lip';

      // Cover and thickness share one wrapper, so a hover lift or tilt moves them together as a single jacket
      const body = document.createElement('div');
      body.className = 'sleeve-body';
      body.append(lift, coverWrap, edge, lip);
      el.appendChild(body);

      // Tilt and glare follow the pointer over the active cover (touch screens have no hover, so skip them)
      if (this.canHover) {
        let frame = null;
        el.addEventListener('pointermove', (e) => {
          if (!el.classList.contains('active') || frame) return;
          frame = requestAnimationFrame(() => {
            frame = null;
            const r = coverWrap.getBoundingClientRect();
            const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
            const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
            el.style.setProperty('--tilt-x', (x - 0.5).toFixed(3));
            el.style.setProperty('--tilt-y', (y - 0.5).toFixed(3));
            el.style.setProperty('--glare-x', `${(x * 100).toFixed(1)}%`);
            el.style.setProperty('--glare-y', `${(y * 100).toFixed(1)}%`);
          });
        });
        el.addEventListener('pointerleave', () => {
          for (const v of ['--tilt-x', '--tilt-y', '--glare-x', '--glare-y']) el.style.removeProperty(v);
        });
      }

      // Card click handling
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (i === this.currentIndex) {
          if (this.onSelect) this.onSelect(this.records[i]);
        } else {
          this.setIndex(i);
        }
      });

      this.container.appendChild(el);
      this.sleeveElements.push({ el, dim, lift, frontSheen, img, record, index: i, z: '', haze: '' });
    }


    this.pos = this.currentIndex;
    this.vel = 0;
    this.updatePositions();
  }

  updatePositions() {
    const total = this.records.length;
    if (total === 0) return;

    if (this.counter) {
      this.counter.textContent = `${this.currentIndex + 1} / ${total}`;
    }

    if (this.onIndexChange) {
      this.onIndexChange(this.currentIndex, total, this.records[this.currentIndex]);
    }

    this.measure();
    this.scrubIndex = -1; // the list may have changed under the same position: say who is at the front again

    if (this.reducedMotion) {
      this.pos = this.currentIndex;
      this.vel = 0;
      this.render();
    } else {
      this.render();
      this.kick();
    }
  }

  measure() {
    this.size = this.container.offsetWidth || this.size;
    // Each row below the active album takes about 42px, so only as many rows as fit the screen (plus a few) are drawn
    const screenHeight = typeof window !== 'undefined' ? window.innerHeight : 1000;
    this.visibleBelow = Math.min(45, Math.ceil(screenHeight / 40) + 3);
    // On a phone the sliver of every album above only adds noise behind the controls
    const phone = typeof window !== 'undefined' && window.innerWidth <= 640;
    this.visibleAbove = phone ? 5 : 12;
    // On a phone the albums stacked above the front one thin out with distance, like objects fading into the haze,
    // and are gone before the header. It is continuous in the album's position, so nothing ever pops in or out.
    this.aboveFadeSpan = phone ? 3.2 : 0;
    // Compact layouts host the title, artist and year under the front cover: phones need room for a two-line title
    this.gap = this.compactMq?.matches ? (phone ? 98 : 64) : 0;
  }

  kick() {
    if (this.raf || typeof requestAnimationFrame === 'undefined') return;
    this.lastT = null;
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  tick(t) {
    const dt = this.lastT === null ? 0 : Math.min(Math.max((t - this.lastT) / 1000, 0), 1 / 30);
    this.lastT = t;

    // Critically damped spring: velocity is continuous, so motion eases in and rapid inputs blend together
    const omega = 12;
    const steps = 4;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const acc = omega * omega * (this.currentIndex - this.pos) - 2 * omega * this.vel;
      this.vel += acc * h;
      this.pos += this.vel * h;
    }

    const settled = Math.abs(this.currentIndex - this.pos) < 0.0008 && Math.abs(this.vel) < 0.004;
    if (settled) {
      this.pos = this.currentIndex;
      this.vel = 0;
      this.speed = 0;
    }

    this.render();
    this.raf = settled ? null : requestAnimationFrame((n) => this.tick(n));
  }

  lerpStep(fn, k) {
    const f = Math.floor(k);
    return fn(f) + (fn(f + 1) - fn(f)) * (k - f);
  }

  poseAt(k, below) {
    const step = this.lerpStep((n) => this.getStackStep(n), k);
    const size = this.size;
    if (below) {
      const yStep = this.lerpStep((n) => this.getBelowYStep(n), k);
      return {
        y: size * 0.74 + yStep * 50 + this.gap,
        z: -175 + step * 18,
        rx: -56,
        s: 0.97 - step * 0.02,
        b: 0.94 - step * 0.08,
      };
    }
    return {
      y: -step * 56 - size * 0.28,
      z: size * -0.46 - step * 25,
      rx: -64,
      s: 0.96 - step * 0.02,
      b: 0.94 - step * 0.08,
    };
  }

  pose(offset) {
    const abs = Math.abs(offset);
    const below = offset > 0;
    if (abs >= 1) return this.poseAt(abs, below);
    const p = this.poseAt(1, below);
    return {
      y: p.y * abs,
      z: p.z * abs,
      rx: p.rx * abs,
      s: 1 + (p.s - 1) * abs,
      b: 1 + (p.b - 1) * abs,
    };
  }

  // Fixed layer bands, back to front: above-stack (<=48), album in transit to/from the active slot (55),
  // lower stack (>=63, deeper in front), and the active album (100) once it is essentially at rest.
  zFor(offset) {
    const abs = Math.abs(offset);
    if (abs < 0.1) return 100;
    if (offset < 0) return Math.max(2, 48 - 2 * Math.floor(abs));
    if (offset < 1) return 55;
    return Math.min(97, 61 + 2 * Math.floor(offset));
  }

  render() {
    for (const item of this.sleeveElements) {
      const offset = item.index - this.pos;
      const rounded = Math.round(offset);
      const absRounded = Math.abs(rounded);
      const out = absRounded > (rounded < 0 ? this.visibleAbove : this.visibleBelow) + 1;

      const state = `${out ? 'o' : ''}${rounded === 0 ? 'a' : rounded < 0 ? 'u' : 'd'}`;
      if (item.state !== state) {
        item.state = state;
        const dir = rounded < 0 ? 'flow-above' : 'flow-below';
        item.el.className = `sleeve ${out ? `out-of-range ${dir}` : rounded === 0 ? 'active' : dir}`;
        // Screen readers only need the sleeve that is up front; the rest of the stack is decoration
        item.el.setAttribute('aria-hidden', String(rounded !== 0));
        item.el.tabIndex = rounded === 0 ? 0 : -1;
      }

      if (out) continue;

      const p = this.pose(offset);
      item.el.style.transform = `perspective(1200px) translate3d(0, ${p.y.toFixed(2)}px, ${p.z.toFixed(2)}px) rotateX(${p.rx.toFixed(3)}deg) scale(${p.s.toFixed(4)})`;
      item.dim.style.opacity = (1 - p.b).toFixed(3);
      const front = Math.max(0, 1 - Math.abs(offset)).toFixed(3);
      item.lift.style.opacity = front;
      item.frontSheen.style.opacity = front;
      if (this.aboveFadeSpan) {
        // Above the front album: full at the front, thinning to nothing over aboveFadeSpan albums
        const t = offset < -1 ? Math.max(0, 1 - (-offset - 1) / this.aboveFadeSpan) : 1;
        const haze = (t * t * (3 - 2 * t)).toFixed(3); // eased, so it thins gently at first
        if (item.haze !== haze) {
          item.haze = haze;
          item.el.style.opacity = haze;
        }
      }

      const z = String(this.zFor(offset));
      if (item.z !== z) {
        item.z = z;
        item.el.style.zIndex = z;
      }
    }

    this.reportScrub();
  }

  // Tells the app which record is nearest the front and how settled the stack is, so the caption under the cover can
  // follow the stack: gone while albums fly past, back (and showing the right album) once they land.
  reportScrub() {
    if (!this.onScrub || !this.records.length) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this.lastRenderT) {
      const seconds = Math.max((now - this.lastRenderT) / 1000, 1 / 120);
      this.speed = this.speed * 0.6 + (Math.abs(this.pos - this.lastPos) / seconds) * 0.4;
    }
    this.lastPos = this.pos;
    this.lastRenderT = now;

    const nearest = Math.round(this.pos);
    const index = Math.max(0, Math.min(this.records.length - 1, nearest));
    const between = Math.abs(this.pos - nearest); // 0 when an album is squarely at the front, 0.5 midway
    const still = Math.min(1, Math.max(0, (6 - this.speed) / 4)); // full below 2 albums a second, gone above 6
    const raw = Math.max(0, 1 - between * 2.5) * still;
    const fade = raw > 0.98 ? 1 : raw;
    if (index !== this.scrubIndex || Math.abs(fade - this.scrubFade) > 0.02 || (fade === 1) !== (this.scrubFade === 1)) {
      this.scrubIndex = index;
      this.scrubFade = fade;
      this.onScrub(index, fade, this.records[index]);
    }
  }

  next() {
    if (this.currentIndex < this.records.length - 1) {
      this.currentIndex++;
      this.updatePositions();
    }
  }

  jumpToLetter(letter) {
    if (!this.records || this.records.length === 0) return;
    const targetChar = letter.toUpperCase();

    const getRecordLetter = (record) => {
      if (this.sortKey === 'artist-first') {
        const name = (record.artist || record.sortArtist || '').trim();
        return name.charAt(0).toUpperCase();
      }
      const name = (parseSortArtist(record.artist) || record.sortArtist || record.artist || '').trim();
      return name.charAt(0).toUpperCase();
    };

    // Find all matching indices for this letter
    const matchingIndices = [];
    for (let i = 0; i < this.records.length; i++) {
      if (getRecordLetter(this.records[i]) === targetChar) {
        matchingIndices.push(i);
      }
    }

    if (matchingIndices.length === 0) return;

    // If currently on one of the matching records, advance to the next matching record (or loop to first)
    const nextMatch = matchingIndices.find((idx) => idx > this.currentIndex);
    const targetIndex = nextMatch !== undefined ? nextMatch : matchingIndices[0];

    if (targetIndex !== this.currentIndex) {
      this.setIndex(targetIndex);
    }
  }

  prev() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.updatePositions();
    }
  }

  bindEvents() {
    // Keyboard navigation: Up/Left = prev, Down/Right = next
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (!this.inStack()) return;
      if (document.querySelector('.gatefold-workspace.open') || document.querySelector('.settings-drawer.open')) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        this.next();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        this.prev();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (this.records[this.currentIndex] && this.onSelect) {
          this.onSelect(this.records[this.currentIndex]);
        }
      } else if (/^[a-zA-Z]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        this.jumpToLetter(e.key.toUpperCase());
      }
    });

    this.bindTouch();
    this.bindWheel();
  }

  inStack() {
    const view = document.body.dataset.view;
    return !view || view === 'stack';
  }

  // Sizes were measured while the stack was hidden, so coming back to it measures again
  refreshLayout() {
    this.measure();
    this.render();
  }

  // Moves the stack to a whole album, keeping whatever speed it already has so the spring carries on smoothly
  goTo(index, velocity = 0) {
    const clamped = Math.max(0, Math.min(this.records.length - 1, index));
    this.vel = velocity;
    if (clamped === this.currentIndex) {
      this.kick();
      return;
    }
    this.currentIndex = clamped;
    this.updatePositions();
  }

  // Touch: the stack follows the finger, and on release the fling's speed decides how many albums it glides past
  bindTouch() {
    const area = this.container.closest?.('.station-crate-col') || this.container;
    const ROW = 46; // pixels of finger travel per album
    const MAX_FLING = 24; // albums a single fling can skip
    let start = null;
    let samples = [];
    let swallowClick = false;
    let dragFrame = null;

    area.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1 || !this.records.length) return;
      cancelAnimationFrame(this.raf);
      this.raf = null;
      start = { y: e.touches[0].clientY, pos: this.pos, moved: false };
      samples = [{ y: start.y, t: e.timeStamp }];
    }, { passive: true });

    area.addEventListener('touchmove', (e) => {
      if (!start) return;
      const y = e.touches[0].clientY;
      if (!start.moved && Math.abs(y - start.y) < 6) return;
      start.moved = true;
      this.pos = Math.max(0, Math.min(this.records.length - 1, start.pos - (y - start.y) / ROW));
      samples.push({ y, t: e.timeStamp });
      if (samples.length > 6) samples.shift();
      // Touch events can arrive faster than the screen refreshes: draw once per frame, not once per event
      if (!dragFrame) {
        dragFrame = requestAnimationFrame(() => {
          dragFrame = null;
          if (this.counter) this.counter.textContent = `${Math.round(this.pos) + 1} / ${this.records.length}`;
          this.render();
        });
      }
    }, { passive: true });

    const finish = (e) => {
      if (!start) return;
      const moved = start.moved;
      start = null;
      if (dragFrame) { cancelAnimationFrame(dragFrame); dragFrame = null; }
      if (!moved) return; // a plain tap is left to the click handler
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 350);
      const last = samples[samples.length - 1];
      const first = samples.find((s) => last.t - s.t <= 120) || samples[0];
      const dt = Math.max(last.t - first.t, 1);
      const rowsPerSecond = -((last.y - first.y) / dt) * 1000 / ROW; // finger up means forward
      const stale = (e.timeStamp - last.t) > 120;
      const fling = stale ? 0 : Math.max(-MAX_FLING, Math.min(MAX_FLING, rowsPerSecond * 0.22));
      this.goTo(Math.round(this.pos + fling), stale ? 0 : rowsPerSecond * 0.5);
    };
    area.addEventListener('touchend', finish, { passive: true });
    area.addEventListener('touchcancel', finish, { passive: true });

    // A drag that ends over a sleeve must not also count as a tap on it
    area.addEventListener('click', (e) => {
      if (swallowClick) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);
  }

  // Wheel and trackpad: scroll distance adds up, so a hard flick travels several albums and a nudge moves one
  bindWheel() {
    const ROW = 70; // pixels of scrolling per album
    let goal = 0;
    let idleTimer = null;

    window.addEventListener('wheel', (e) => {
      if (document.querySelector('.gatefold-workspace.open') || document.querySelector('.settings-drawer.open')) return;
      if (!this.records.length || !this.inStack()) return;

      let delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (e.deltaMode === 1) delta *= 16; // lines
      if (delta === 0) return;

      if (Math.round(goal) !== this.currentIndex || goal < 0) goal = this.currentIndex; // moved by keys or clicks since
      // A notched mouse wheel sends big whole steps: one album per click. A trackpad sends many small ones.
      const rows = Math.abs(delta) >= 100 ? Math.sign(delta) : (delta * (1 + Math.min(Math.abs(delta) / 100, 0.5))) / ROW;
      goal = Math.max(0, Math.min(this.records.length - 1, goal + rows));

      const target = Math.round(goal);
      if (target !== this.currentIndex) {
        this.currentIndex = target;
        this.updatePositions();
      }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { goal = this.currentIndex; }, 200);
    }, { passive: true });
  }

  escapeHTML(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

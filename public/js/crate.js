// crate.js - Vertical 3D Cover Flow with persistent element animations
import { parseSortArtist } from './sync.js';

// The stack shows covers at about 300 to 500 points wide, so 600px art is plenty; the album page keeps the 1200px version.
// (Decoding 1200px art for every sleeve is what makes flipping through a big crate heavy on a phone.)
function crateArtUrl(record) {
  const url = record.artwork?.highRes || record.artwork?.thumbnail || '';
  return url.replace('1200x1200bb', '600x600bb');
}

export class CrateController {
  constructor(containerEl, counterEl, onSelectRecord, onIndexChange) {
    this.container = containerEl;
    this.counter = counterEl;
    this.onSelect = onSelectRecord;
    this.onIndexChange = onIndexChange;
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
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'empty-crate-msg';
      emptyMsg.innerHTML =  /*html*/ '<p>Your record crate is empty.</p><small>Sync with Discogs or reload demo collection.</small>';
      this.container.appendChild(emptyMsg);
      if (this.onIndexChange) this.onIndexChange(0, 0, null);
      return;
    }

    // Build persistent sleeve DOM elements once so CSS transitions can animate between positions
    for (let i = 0; i < total; i++) {
      const record = this.records[i];
      const el = document.createElement('div');
      el.className = 'sleeve';
      el.dataset.index = String(i);

      // Solid jacket cover wrapper
      const coverWrap = document.createElement('div');
      coverWrap.className = 'sleeve-cover-wrap';

      // Cover artwork image
      const img = document.createElement('img');
      img.src = crateArtUrl(record);
      img.alt = `${record.artist} - ${record.title}`;
      img.loading = i <= 3 ? 'eager' : 'lazy';

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
      coverWrap.appendChild(dim);

      // The jacket's thickness: a bevelled edge and a lit top lip just outside the artwork, never over it
      const edge = document.createElement('div');
      edge.className = 'sleeve-edge';

      const lip = document.createElement('div');
      lip.className = 'sleeve-lip';

      // Cover and thickness share one wrapper, so a hover lift or tilt moves them together as a single jacket
      const body = document.createElement('div');
      body.className = 'sleeve-body';
      body.append(coverWrap, edge, lip);
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
      this.sleeveElements.push({ el, dim, img, record, index: i });
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
    this.gap = this.compactMq?.matches ? 64 : 0;
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
      }

      if (out) continue;

      const p = this.pose(offset);
      item.el.style.transform = `perspective(1200px) translate3d(0, ${p.y.toFixed(2)}px, ${p.z.toFixed(2)}px) rotateX(${p.rx.toFixed(3)}deg) scale(${p.s.toFixed(4)})`;
      item.dim.style.opacity = (1 - p.b).toFixed(3);

      item.el.style.zIndex = String(this.zFor(offset));
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

    // Touch swipe gestures
    let touchStartY = 0;
    let touchStartTime = 0;

    this.container.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      touchStartY = touch.clientY;
      touchStartTime = Date.now();
    }, { passive: true });

    this.container.addEventListener('touchend', (e) => {
      const touch = e.changedTouches[0];
      const deltaY = touch.clientY - touchStartY;
      const elapsedTime = Date.now() - touchStartTime;

      if (elapsedTime > 600) return;

      if (Math.abs(deltaY) > 28) {
        if (deltaY < 0) {
          this.next();
        } else {
          this.prev();
        }
      }
    }, { passive: true });

    // Vertical mouse wheel with momentum debounce
    let wheelDebounce = false;
    window.addEventListener('wheel', (e) => {
      if (document.querySelector('.gatefold-workspace.open') || document.querySelector('.settings-drawer.open')) return;
      if (wheelDebounce) return;

      const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;

      if (Math.abs(delta) > 14) {
        wheelDebounce = true;
        if (delta > 0) {
          this.next();
        } else {
          this.prev();
        }
        setTimeout(() => { wheelDebounce = false; }, 160);
      }
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

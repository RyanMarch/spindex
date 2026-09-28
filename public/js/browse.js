// browse.js - the grid and list views of the collection. The stack is one way to look through a crate; these are
// the others: every cover at once, or a table with the details beside each one.
import { crateArtUrl } from './crate.js';
import { parseVinyl, vinylFill, formatsOf } from './vinyl.js';
import { parseSortArtist } from './sync.js';
import { sortYear } from './years.js';

export const VIEWS = ['stack', 'grid', 'list'];

export function normalizeView(value) {
  return VIEWS.includes(value) ? value : 'stack';
}

// The stack wants big covers; a grid tile or list thumbnail is a fraction of that, so ask the source for less
export function smallArtUrl(record, size) {
  const url = crateArtUrl(record);
  return url.replace('600x600bb', `${size}x${size}bb`).replace('/500x500-', `/${size}x${size}-`);
}

// Small facts about the pressing worth seeing at a glance, from what Discogs says about the format
const TAG_WORDS = [
  [/limited/i, 'Limited'],
  [/reissue|repress/i, 'Reissue'],
  [/remaster/i, 'Remaster'],
  [/180\s*gram/i, '180g'],
  [/picture\s*disc/i, 'Picture disc'],
  [/numbered/i, 'Numbered'],
  [/deluxe|special edition|anniversary/i, 'Deluxe'],
  [/^ep$|mini-album/i, 'EP'],
  [/single/i, 'Single'],
];

export function cardTags(record) {
  const formats = formatsOf(record);
  if (!formats?.length) return [];
  const tags = [];
  const vinyl = formats.find((f) => /vinyl|^lp$/i.test(f.name || '')) || formats[0];
  const qty = Number(vinyl?.qty) || 1;
  if (qty > 1) tags.push(`${qty} × LP`);
  const look = parseVinyl(formats);
  if (look.kind !== 'black' && look.kind !== 'picture' && vinyl?.text) tags.push(vinyl.text.replace(/\s*\[.*?\]/g, '').trim());
  const words = [vinyl?.text, ...(vinyl?.descriptions || [])].filter(Boolean).join(' ');
  for (const [re, label] of TAG_WORDS) if (re.test(words) && !tags.includes(label)) tags.push(label);
  const size = (vinyl?.descriptions || []).find((d) => /^(7|10)"$/.test(d));
  if (size) tags.unshift(size);
  return tags.slice(0, 3);
}

// The record peeking from a tile wears the pressing's colour
const GROOVES = 'repeating-radial-gradient(circle, rgba(0, 0, 0, 0.3) 0px, rgba(0, 0, 0, 0.3) 1px, rgba(255, 255, 255, 0.05) 1px, rgba(255, 255, 255, 0.05) 2px, rgba(0, 0, 0, 0) 2px, rgba(0, 0, 0, 0) 4px)';
function discBackground(record) {
  try {
    const look = parseVinyl(formatsOf(record));
    if (look.kind === 'black' || look.kind === 'picture') return '';
    return `${GROOVES}, ${vinylFill(look, '')}`;
  } catch {
    return '';
  }
}

// What the jump rail is made of depends on the sort: letters for names, decades for years, nothing for the rest
export function railLabel(sort, record) {
  if (sort === 'year') {
    const year = sortYear(record);
    return year ? `${Math.floor(year / 10) * 10}s` : '–';
  }
  if (sort === 'artist-last-year' || sort === 'artist' || sort === 'artist-first') {
    const name = (sort === 'artist-first' ? record.artist : parseSortArtist(record.artist) || record.sortArtist || record.artist) || '';
    const ch = name.trim().charAt(0).toUpperCase();
    return /[A-Z]/.test(ch) ? ch : '#';
  }
  return null;
}

// One entry per run of records that share a label: where each letter (or decade) starts
export function groupRail(records, labelOf) {
  const groups = [];
  if (!labelOf) return groups;
  records.forEach((record, index) => {
    const label = labelOf(record);
    if (label && groups[groups.length - 1]?.label !== label) groups.push({ label, index });
  });
  return groups;
}

// The columns a list can be sorted by, and the sort each one asks for
export const LIST_COLUMNS = [
  { key: 'artist', label: 'Album / Artist', sort: 'artist-last-year' },
  { key: 'year', label: 'Year', sort: 'year' },
  { key: 'genre', label: 'Genre', sort: 'genre' },
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class BrowseView {
  // describe(record) -> { year, genre, length }; onOpen(index); onSort(sortValue)
  constructor({ root, rail, describe, onOpen, onSort, onJump }) {
    this.onJump = onJump;
    this.root = root;
    this.rail = rail;
    this.groups = [];
    this.describe = describe;
    this.onSort = onSort;
    this.records = [];
    this.view = 'grid';
    this.sort = '';
    this.items = [];
    this.activeIndex = -1;

    root.addEventListener('click', (e) => {
      const item = e.target.closest('.bv-item');
      if (item) {
        onOpen(Number(item.dataset.index));
        return;
      }
      const head = e.target.closest('[data-sort]');
      if (head && this.onSort) this.onSort(head.dataset.sort);
    });

    this.bindRail();
    this.bindHoverTilt();
    let ticking = false;
    root.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; this.markRail(); });
    }, { passive: true });
  }

  // ---- Jump rail: the letters (or decades) down the edge, tap or drag to go there ----

  buildRail(records, railKey) {
    this.groups = groupRail(records, railKey);
    const show = this.groups.length > 1;
    this.root.classList.toggle('has-rail', show);
    if (!this.rail) return;
    this.rail.hidden = !show;
    this.rail.replaceChildren();
    if (!show) return;
    for (const g of this.groups) {
      const b = el('button', 'bv-rail-key', g.label);
      b.type = 'button';
      b.dataset.label = g.label;
      b.tabIndex = -1;
      this.rail.append(b);
    }
    this.bubble = el('div', 'bv-rail-bubble');
    this.rail.append(this.bubble);
  }

  jumpTo(label) {
    const g = this.groups.find((x) => x.label === label);
    if (!g) return;
    if (!(this.onJump && this.onJump(g.index))) this.items[g.index]?.scrollIntoView({ block: 'start' });
    this.markRail(label);
    if (this.bubble) {
      const activeBtn = this.rail.querySelector(`[data-label="${label}"]`);
      if (activeBtn) {
        this.bubble.style.top = `${activeBtn.offsetTop + activeBtn.offsetHeight / 2}px`;
      }
      this.bubble.textContent = label;
      this.bubble.classList.add('is-on');
      clearTimeout(this.bubbleTimer);
      this.bubbleTimer = setTimeout(() => this.bubble.classList.remove('is-on'), 700);
    }
  }

  bindRail() {
    if (!this.rail) return;
    let dragging = false;
    let last = null;

    const labelAt = (e) => {
      const elAt = document.elementFromPoint(e.clientX, e.clientY);
      const key = elAt?.closest?.('.bv-rail-key');
      if (key?.dataset.label) return key.dataset.label;
      if (dragging) {
        const r = this.rail.getBoundingClientRect();
        if (e.clientY >= r.top - 20 && e.clientY <= r.bottom + 20) {
          const keys = [...this.rail.querySelectorAll('.bv-rail-key')];
          let closest = null;
          let minDist = Infinity;
          for (const k of keys) {
            const kr = k.getBoundingClientRect();
            const dist = Math.abs(e.clientY - (kr.top + kr.height / 2));
            if (dist < minDist) {
              minDist = dist;
              closest = k;
            }
          }
          return closest?.dataset.label || null;
        }
      }
      return null;
    };

    const go = (e) => {
      const label = labelAt(e);
      if (label && label !== last) {
        last = label;
        this.jumpTo(label);
      }
    };

    this.rail.addEventListener('pointerdown', (e) => {
      dragging = true;
      last = null;
      this.rail.setPointerCapture?.(e.pointerId);
      go(e);
    });

    this.rail.addEventListener('pointermove', (e) => { if (dragging) go(e); });

    const stop = () => {
      dragging = false;
      clearTimeout(this.bubbleTimer);
      this.bubbleTimer = setTimeout(() => this.bubble?.classList.remove('is-on'), 400);
    };

    this.rail.addEventListener('pointerup', stop);
    this.rail.addEventListener('pointercancel', stop);
  }

  // Tilt and subtle glare track the pointer over grid tiles
  bindHoverTilt() {
    const canHover = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches);
    if (!canHover) return;

    let activeTile = null;
    let frame = null;
    let lastX = 0;
    let lastY = 0;

    const clearTile = (tile) => {
      if (!tile) return;
      tile.style.removeProperty('--tilt-x');
      tile.style.removeProperty('--tilt-y');
      tile.style.removeProperty('--glare-x');
      tile.style.removeProperty('--glare-y');
    };

    const updateTilt = () => {
      frame = null;
      if (!activeTile) return;
      const art = activeTile.querySelector('.bv-art') || activeTile;
      const r = art.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const x = Math.min(1, Math.max(0, (lastX - r.left) / r.width));
        const y = Math.min(1, Math.max(0, (lastY - r.top) / r.height));
        activeTile.style.setProperty('--tilt-x', (x - 0.5).toFixed(3));
        activeTile.style.setProperty('--tilt-y', (y - 0.5).toFixed(3));
        activeTile.style.setProperty('--glare-x', `${(x * 100).toFixed(1)}%`);
        activeTile.style.setProperty('--glare-y', `${(y * 100).toFixed(1)}%`);
      }
    };

    this.root.addEventListener('pointermove', (e) => {
      if (this.view !== 'grid') {
        if (activeTile) {
          clearTile(activeTile);
          activeTile = null;
        }
        return;
      }

      const tile = e.target.closest('.bv-tile');
      if (tile !== activeTile) {
        clearTile(activeTile);
        activeTile = tile;
      }
      if (!tile) return;

      lastX = e.clientX;
      lastY = e.clientY;

      if (!frame) {
        frame = requestAnimationFrame(updateTilt);
      }
    });

    const resetActive = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      clearTile(activeTile);
      activeTile = null;
    };

    this.root.addEventListener('pointerleave', resetActive);
    this.root.addEventListener('scroll', resetActive, { passive: true });
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', resetActive);
    }
  }

  groupFor(index) {
    return ([...this.groups].reverse().find((x) => x.index <= index) || this.groups[0])?.label;
  }

  // Lights the letter for whatever is at the top of the screen
  markRail(forced) {
    if (!this.rail || this.rail.hidden) return;
    let label = forced;
    if (!label) {
      const top = this.root.scrollTop + 90;
      let idx = 0;
      for (let i = 0; i < this.items.length; i++) {
        if (this.items[i].offsetTop + this.items[i].offsetHeight > top) { idx = i; break; }
      }
      const g = [...this.groups].reverse().find((x) => x.index <= idx) || this.groups[0];
      label = g?.label;
    }
    if (label === this.railActive) return;
    this.railActive = label;
    for (const key of this.rail.querySelectorAll('.bv-rail-key')) key.classList.toggle('is-on', key.dataset.label === label);
  }

  render(records, view, sort, activeIndex = -1, railKey = null) {
    this.records = records;
    this.view = view;
    this.sort = sort;
    this.items = [];
    this.root.replaceChildren();
    this.root.dataset.mode = view;

    if (!records.length) {
      this.buildRail([], null); // what to say about an empty crate is the app's job (emptystate.js)
      return;
    }

    const wrap = el('div', view === 'list' ? 'bv-list' : 'bv-grid');
    if (view === 'list') wrap.append(this.header());
    const frag = document.createDocumentFragment();
    records.forEach((record, i) => frag.append(view === 'list' ? this.row(record, i) : this.tile(record, i)));
    wrap.append(frag);
    this.root.append(wrap);
    this.setActive(activeIndex);
    this.buildRail(records, railKey);
    this.railActive = null;
    this.markRail();
  }

  header() {
    const head = el('div', 'bv-head');
    head.append(el('span'));
    for (const col of LIST_COLUMNS) {
      const sorted = col.sort === this.sort || (col.key === 'artist' && this.sort === 'artist');
      const btn = el('button', `bv-h bv-h-${col.key}${sorted ? ' is-sorted' : ''}`, col.label);
      btn.type = 'button';
      btn.dataset.sort = col.sort;
      head.append(btn);
    }
    head.append(el('span', 'bv-h bv-h-length', 'Length'));
    return head;
  }

  tagsEl(record) {
    const wrap = el('span', 'bv-tags');
    for (const t of cardTags(record)) wrap.append(el('span', 'bv-tag', t));
    return wrap;
  }

  art(record, size, className) {
    const img = el('img', className);
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = smallArtUrl(record, size);
    img.onerror = () => { img.style.visibility = 'hidden'; };
    return img;
  }

  tile(record, index) {
    const d = this.describe(record);
    const tile = el('button', 'bv-item bv-tile');
    tile.type = 'button';
    tile.dataset.index = String(index);
    tile.setAttribute('aria-label', `${record.title} by ${record.artist}`);
    const art = el('span', 'bv-art');
    const disc = el('span', 'bv-disc');
    const fill = discBackground(record);
    if (fill) disc.style.background = fill;
    art.append(disc, this.art(record, 300, 'bv-cover'));
    const sub = [record.artist, d.year].filter(Boolean).join(' · ');
    tile.append(art, el('span', 'bv-title', record.title || 'Untitled'), el('span', 'bv-sub', sub));
    if (d.track) tile.append(el('span', 'bv-hit', `Track: ${d.track}`));
    this.items.push(tile);
    return tile;
  }

  row(record, index) {
    const d = this.describe(record);
    const row = el('button', 'bv-item bv-row');
    row.type = 'button';
    row.dataset.index = String(index);
    row.setAttribute('aria-label', `${record.title} by ${record.artist}`);
    const main = el('span', 'bv-main');
    const line = el('span', 'bv-line');
    line.append(el('span', 'bv-sub', record.artist || ''), this.tagsEl(record));
    main.append(el('span', 'bv-title', record.title || 'Untitled'), line);
    if (d.track) main.append(el('span', 'bv-hit', `Track: ${d.track}`));
    row.append(
      this.art(record, 120, 'bv-thumb'),
      main,
      el('span', 'bv-year', d.year || ''),
      el('span', 'bv-genre', d.genre || ''),
      el('span', 'bv-length', d.length || ''),
    );
    this.items.push(row);
    return row;
  }

  // Marks the record the stack is on, so switching views keeps your place
  setActive(index) {
    this.items[this.activeIndex]?.classList.remove('is-current');
    this.activeIndex = index;
    this.items[index]?.classList.add('is-current');
  }

  // A brief ring around a record, so the eye finds where "surprise me" landed
  pulse(index) {
    const item = this.items[index];
    if (!item) return;
    item.classList.remove('is-pulse');
    void item.offsetWidth;
    item.classList.add('is-pulse');
    setTimeout(() => item.classList.remove('is-pulse'), 1300);
  }

  scrollToActive(behavior = 'auto') {
    this.items[this.activeIndex]?.scrollIntoView({ block: 'center', behavior });
  }

  // Same records, same order, fresher data: only pictures that changed are swapped, so nothing moves
  refresh(records) {
    if (records.length !== this.items.length) return;
    this.records = records;
    const size = this.view === 'list' ? 120 : 300;
    this.items.forEach((item, i) => {
      const img = item.querySelector('img');
      const url = smallArtUrl(records[i], size);
      if (img && img.getAttribute('src') !== url) img.src = url;
      // Details arrive over time: tags and the colowred record appear in place, without moving anything
      const tags = item.querySelector('.bv-tags');
      if (tags) tags.replaceWith(this.tagsEl(records[i]));
      const disc = item.querySelector('.bv-disc');
      const fill = disc ? discBackground(records[i]) : '';
      if (disc && fill) disc.style.background = fill;
    });
  }
}

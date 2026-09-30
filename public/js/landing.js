// landing.js - Controller for the Spindex home page: the hero crate, the view previews, and the demo-data sections
import { MOCK_RECORDS } from './mock-data.js';
import { LandingWall } from './landing-wall.js';
import { computeStats } from './stats.js';
import { ledeHTML, section, spinesHTML, renderStandoutItem } from './statsview.js';

// A hand-picked tint for each demo cover (the app derives its own glow from the artwork)
const GLOW = [
  'rgba(59, 130, 246, 0.5)',
  'rgba(245, 158, 11, 0.5)',
  'rgba(249, 115, 22, 0.5)',
  'rgba(168, 85, 247, 0.5)',
  'rgba(244, 63, 94, 0.5)',
  'rgba(100, 116, 139, 0.5)',
  'rgba(251, 146, 60, 0.5)',
  'rgba(16, 185, 129, 0.5)',
  'rgba(99, 102, 241, 0.5)',
  'rgba(20, 184, 166, 0.5)',
];
// How far the stack shows on either side of the front record
const VISIBLE_ABOVE = 2;
const VISIBLE_BELOW = 3;
const AUTOPLAY_MS = 4500;

// The app's own stack maths (crate.js poseAt): each record leans back and steps up or down from the front one
const stackStep = (k) => {
  if (k <= 0) return 0;
  if (k === 1) return 1;
  if (k === 2) return 1.85;
  if (k === 3) return 2.55;
  return 2.55 + 2.2 * (1 - 0.75 ** (k - 3));
};
const belowYStep = (k) => {
  if (k <= 0) return 0;
  if (k === 1) return 1;
  if (k === 2) return 1.9;
  return 2.75 + 0.85 * (k - 3);
};
const pose = (offset, size) => {
  if (offset === 0) return { y: 0, z: 0, rx: 0, s: 1, b: 1 };
  const k = Math.abs(offset);
  const step = stackStep(k);
  if (offset > 0) {
    return { y: size * 0.74 + belowYStep(k) * 50, z: -175 + step * 18, rx: -56, s: 0.97 - step * 0.02, b: 0.94 - step * 0.08 };
  }
  return { y: -step * 56 - size * 0.28, z: size * -0.46 - step * 25, rx: -64, s: 0.96 - step * 0.02, b: 0.94 - step * 0.08 };
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The demo covers come from iTunes at 1000px; the small slots don't need that many pixels
const art = (record, size = 600) => (record.artwork?.thumbnail || '').replace('1000x1000bb', `${size}x${size}bb`);

const seconds = (d) => {
  const [m, s] = String(d || '0:0').split(':').map(Number);
  return (m || 0) * 60 + (s || 0);
};

export class LandingPageController {
  constructor(options = {}) {
    this.onEnterCrate = options.onEnterCrate || (() => {});
    this.onOpenRecord = options.onOpenRecord || (() => {});
    this.isConnected = options.isConnected || (() => false);
    this.root = document.getElementById('landing-page');
    this.all = MOCK_RECORDS;
    this.records = MOCK_RECORDS.slice(0, 10);
    this.currentIndex = 0;
    this.interacted = false;
    this.timers = [];
    this.reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (!this.root) return;

    this.initElements();
    this.buildCrate();
    this.bindEvents();
    this.renderCrate();
    this.initInteractiveTabs();
    this.renderGatefold();
    this.buildWall();
    this.renderStats();
    this.watchReveals();
  }

  initElements() {
    this.stage = document.getElementById('landing-crate-stage');
    this.glow = document.getElementById('landing-crate-glow');
    this.prevBtn = document.getElementById('landing-crate-prev');
    this.nextBtn = document.getElementById('landing-crate-next');
    this.metaTitle = document.getElementById('landing-meta-title');
    this.metaArtist = document.getElementById('landing-meta-artist');
    this.metaYear = document.getElementById('landing-meta-year');
    this.metaDuration = document.getElementById('landing-meta-duration');
    this.metaTracks = document.getElementById('landing-meta-tracks');
    this.metaGenres = document.getElementById('landing-meta-genres');
    this.count = document.getElementById('landing-crate-count');
    this.openBtn = document.getElementById('landing-open-btn');
  }

  // ---- The hero crate ----------------------------------------------------------------------------------------------
  // Built once and only re-posed afterwards, so each sleeve glides to its new place instead of being replaced.

  buildCrate() {
    if (!this.stage) return;
    this.sleeves = this.records.map((record, index) => {
      const sleeve = document.createElement('div');
      sleeve.className = 'mini-sleeve';
      sleeve.setAttribute('role', 'button');
      sleeve.setAttribute('aria-label', `${record.title} by ${record.artist}`);
      sleeve.innerHTML =  /*html*/ `
        <div class="mini-lift"></div>
        <div class="mini-cover">
          <img src="${esc(art(record))}" alt="" loading="${index < 4 ? 'eager' : 'lazy'}" draggable="false">
          <div class="mini-sheen"></div>
          <div class="mini-dim"></div>
        </div>`;
      this.stage.appendChild(sleeve);
      return sleeve;
    });
    // The stack's size follows its column; lay it out again, without gliding, when that changes
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => {
        if (this.stage.offsetWidth !== this.laidOutAt) this.layout();
      }).observe(this.stage);
    }
  }

  // Poses everything for the current width without animating (first showing, resizes)
  layout() {
    if (!this.stage) return;
    this.stage.classList.add('no-glide');
    this.renderCrate();
    void this.stage.offsetWidth;
    this.stage.classList.remove('no-glide');
  }

  step(delta) {
    const total = this.records.length;
    this.currentIndex = (this.currentIndex + delta + total) % total;
    this.renderCrate();
  }

  goTo(index) {
    this.currentIndex = index;
    this.renderCrate();
  }

  renderCrate() {
    if (!this.sleeves) return;
    const total = this.records.length;
    const current = this.records[this.currentIndex];
    const size = this.stage.offsetWidth;
    this.laidOutAt = size;

    this.sleeves.forEach((sleeve, index) => {
      // Offset from the front record, wrapped so the crate is endless: -3 (just gone off the top) to total-4
      let offset = (((index - this.currentIndex) % total) + total) % total;
      if (offset > total - 4) offset -= total;

      const p = pose(offset, size);
      const shown = offset >= -VISIBLE_ABOVE && offset <= VISIBLE_BELOW;
      // Above the front record the stack thins out; below it, the fade comes from the column's mask
      const haze = offset < -1 ? Math.max(0, 1 - (-offset - 1) / 2.2) : 1;
      sleeve.style.transform = `perspective(1200px) translate3d(0, ${p.y.toFixed(1)}px, ${p.z.toFixed(1)}px) rotateX(${p.rx}deg) scale(${p.s.toFixed(3)})`;
      sleeve.style.opacity = shown ? String(haze * haze * (3 - 2 * haze)) : '0';
      sleeve.style.pointerEvents = shown ? 'auto' : 'none';
      sleeve.style.zIndex = String(offset === 0 ? 100 : offset < 0 ? Math.max(2, 48 - 2 * -offset) : Math.min(97, 61 + 2 * offset));
      sleeve.classList.toggle('is-front', offset === 0);
      sleeve.querySelector('.mini-dim').style.opacity = (1 - p.b).toFixed(2);
      sleeve.setAttribute('aria-hidden', offset === 0 ? 'false' : 'true');
      sleeve.tabIndex = -1;
    });

    const minutes = Math.round((current.tracklist || []).reduce((sum, t) => sum + seconds(t.duration), 0) / 60);
    const tracks = current.tracklist?.length || 0;
    this.metaTitle.textContent = current.title;
    this.metaArtist.textContent = current.artist;
    this.metaYear.textContent = String(current.year);
    this.metaDuration.textContent = minutes ? `${minutes} min` : '';
    this.metaTracks.textContent = tracks ? `${tracks} tracks` : '';
    this.metaGenres.innerHTML =  /*html*/ [...current.genres, ...(current.styles || [])].slice(0, 3)
      .map((g) => `<span class="meta-genre-tag">${esc(g)}</span>`).join('');
    if (this.count) this.count.textContent = `${this.currentIndex + 1} / ${total}`;
    if (this.glow) this.glow.style.backgroundColor = GLOW[this.currentIndex % GLOW.length];
  }

  openCurrent() {
    const record = this.records[this.currentIndex];
    this.dismiss();
    this.onOpenRecord(record);
  }

  userStep(delta) {
    this.interacted = true;
    this.step(delta);
  }

  bindEvents() {
    this.prevBtn?.addEventListener('click', () => this.userStep(-1));
    this.nextBtn?.addEventListener('click', () => this.userStep(1));
    this.openBtn?.addEventListener('click', () => this.openCurrent());

    // While the home page is showing, the app underneath (hidden, but still listening) must not see the keyboard: its
    // arrows, letters and Enter would drive a crate nobody can see. Keys stop here instead, and the browser's own
    // behaviour (scrolling, pressing a focused button or link) is left alone. The crate and the view tabs only claim
    // the keys they need while they have focus.
    window.addEventListener('keydown', (e) => {
      if (this.root.hidden) return;
      if (this.stage?.contains(e.target)) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          e.preventDefault();
          this.userStep(-1);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          e.preventDefault();
          this.userStep(1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          this.openCurrent();
        }
      }
      e.stopPropagation();
    }, true);

    // Drag the stack up or down to flip (touch keeps scrolling the page; the arrows are there for it). A plain click on
    // a record below brings it forward, and on the front one opens it.
    if (this.stage) {
      let startY = null;
      let moved = false;
      this.stage.addEventListener('pointerdown', (e) => {
        startY = e.clientY;
        moved = false;
      });
      this.stage.addEventListener('pointermove', (e) => {
        if (startY !== null && Math.abs(e.clientY - startY) > 8) moved = true;
      });
      this.stage.addEventListener('pointerup', (e) => {
        if (startY === null) return;
        const dy = e.clientY - startY;
        startY = null;
        if (Math.abs(dy) > 40) this.userStep(dy < 0 ? 1 : -1);
      });
      this.stage.addEventListener('pointercancel', () => { startY = null; });
      this.stage.addEventListener('click', (e) => {
        if (moved) return;
        const index = this.sleeves.indexOf(e.target.closest('.mini-sleeve'));
        if (index === -1) return;
        this.interacted = true;
        if (index === this.currentIndex) this.openCurrent();
        else this.goTo(index);
      });
      this.stage.addEventListener('pointerenter', () => { this.hovering = true; });
      this.stage.addEventListener('pointerleave', () => { this.hovering = false; });
      this.stage.addEventListener('focusin', () => { this.interacted = true; });
    }

    this.root.addEventListener('click', (e) => {
      if (e.target.closest('[data-landing-connect]')) {
        try { localStorage.setItem('spindex_welcomed', '1'); } catch { /* fine */ }
        return; // the link goes on to Discogs
      }
      const trigger = e.target.closest('[data-landing-action="enter-crate"]');
      if (!trigger) return;
      e.preventDefault();
      this.dismiss();
      this.onEnterCrate();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stopTimers();
      else if (!this.root.hidden) this.startTimers();
      this.syncWall();
    });
  }

  // ---- Timers: the hero crate turns on its own until someone touches it; the screensaver caption changes ------------

  startTimers() {
    this.stopTimers();
    if (this.reduceMotion) return;
    this.timers.push(setInterval(() => {
      if (!this.interacted && !this.hovering && this.heroVisible !== false) this.step(1);
    }, AUTOPLAY_MS));
  }

  stopTimers() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  // ---- Stack / grid / list preview ---------------------------------------------------------------------------------

  initInteractiveTabs() {
    const tabs = [...this.root.querySelectorAll('.landing-seg-btn')];
    this.display = document.getElementById('landing-view-display');
    if (!this.display || !tabs.length) return;

    const select = (tab) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
      });
      this.renderViewPreview(this.display, tab.dataset.viewType);
    };

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => select(tab));
    });

    // Arrow keys move between the view tabs. This listens on the window's capture phase, like the guard in
    // bindEvents, because the guard stops keys from reaching the buttons themselves.
    window.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(document.activeElement);
      const dir = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (i === -1 || !dir || this.root.hidden) return;
      e.preventDefault();
      const target = tabs[(i + dir + tabs.length) % tabs.length];
      target.focus();
      select(target);
    }, true);
    select(tabs[0]);
  }

  renderViewPreview(container, viewType) {
    if (viewType === 'grid') {
      container.innerHTML =  /*html*/ `
        <div class="lv-grid">
          ${this.all.slice(0, 8).map((r) => `
            <figure>
              <img src="${esc(art(r, 400))}" alt="${esc(r.title)} by ${esc(r.artist)}" loading="lazy">
              <figcaption><strong>${esc(r.title)}</strong><br>${esc(r.artist)}</figcaption>
            </figure>`).join('')}
        </div>`;
    } else if (viewType === 'list') {
      container.innerHTML =  /*html*/ `
        <div class="lv-list">
          ${this.all.slice(0, 5).map((r) => `
            <div class="lv-row">
              <img src="${esc(art(r, 120))}" alt="" loading="lazy">
              <div><strong>${esc(r.title)}</strong><small>${esc(r.artist)}</small></div>
              <span>${esc(r.year)}</span>
              <span>${esc(r.genres[0] || 'Vinyl')}</span>
              <span>${esc(r.format[1] || 'LP')}</span>
            </div>`).join('')}
        </div>`;
    } else {
      const [front, ...rest] = [...this.records.slice(this.currentIndex), ...this.records.slice(0, this.currentIndex)];
      const tracks = front.tracklist?.length;
      container.innerHTML =  /*html*/ `
        <div class="lv-stack">
          <div class="lv-stack-art">
            <img src="${esc(art(front))}" alt="${esc(front.title)} by ${esc(front.artist)}">
            ${rest.slice(0, 3).map((r) => `<img class="lv-edge" src="${esc(art(r, 300))}" alt="">`).join('')}
          </div>
          <div class="lv-stack-meta">
            <h4>${esc(front.title)}</h4>
            <p>${esc(front.artist)}</p>
            <p>${esc(front.year)}${tracks ? ` · ${tracks} tracks` : ''}</p>
            <span class="landing-tag">${esc([...front.genres, ...(front.styles || []).slice(0, 1)].join(' / '))}</span>
          </div>
        </div>`;
    }
  }

  // ---- Sections built from the demo data ---------------------------------------------------------------------------

  renderGatefold() {
    const host = document.getElementById('landing-gatefold-art');
    const record = this.all.find((r) => r.title === 'Hounds of Love') || this.all[3] || this.all[0];
    if (!host || !record) return;
    host.innerHTML =  /*html*/ `
      <div class="gf-mock" style="--label-art:url('${esc(art(record, 300))}')">
        <div class="gf-mock-disc"></div>
        <img class="gf-mock-jacket" src="${esc(art(record))}" alt="" loading="lazy">
      </div>`;
    this.gatefold = host.querySelector('.gf-mock');
  }

  // The screensaver, as the real thing in a box (see landing-wall.js). It runs only while it is on screen.
  buildWall() {
    const host = document.getElementById('landing-wall');
    if (!host) return;
    this.wallHost = host;
    this.wall = new LandingWall({
      host,
      records: this.all,
      art,
      getFree: () => this.wallFree(),
      onOpen: (record) => {
        this.dismiss();
        this.onOpenRecord(record);
      },
    });
  }

  // The part of the wall's box that the copy panel isn't over, where a raised cover may go. On a narrow screen the
  // panel covers it all, and the wall just drifts.
  wallFree() {
    const box = this.wallHost.getBoundingClientRect();
    const panel = this.root.querySelector('.landing-poster-panel')?.getBoundingClientRect();
    if (!panel || box.width < 900) return null;
    const left = panel.right - box.left + 32;
    const width = box.width - left - 32;
    return width >= 280 ? { left, width } : null;
  }

  // The app's own stats panel, worked out from the demo crate by the app's own code (stats.js, statsview.js). The app
  // shows a random four of its fun facts; here they are a fixed four that read well together.
  renderStats() {
    const host = document.getElementById('landing-stats');
    if (!host) return;
    const stats = computeStats(this.all);
    const pool = new Map(stats.standoutsPool.map((item) => [item.id, item]));
    const facts = ['favorite-add-day', 'collection-weight', 'longest-track', 'most-tracks'].map((id) => pool.get(id)).filter(Boolean);
    host.innerHTML =  /*html*/ [
      ledeHTML(stats),
      stats.decades.length ? section('On the shelf', spinesHTML(stats.decades)) : '',
      facts.length ? section('Fun facts', `<ul class="st-standouts">${facts.map(renderStandoutItem).join('')}</ul>`) : '',
    ].join('');
  }

  // Animate things in only when they scroll into view, and only once
  watchReveals() {
    const targets = [
      [this.gatefold, 'is-open'],
    ].filter(([el]) => el);
    if (!('IntersectionObserver' in window)) {
      targets.forEach(([el, cls]) => el.classList.add(cls));
      this.wallVisible = true;
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add(entry.target.dataset.reveal);
        io.unobserve(entry.target);
      });
    }, { threshold: 0.35 });
    targets.forEach(([el, cls]) => { el.dataset.reveal = cls; io.observe(el); });

    // The wall only runs while it is on screen
    const poster = document.getElementById('screensaver');
    if (poster && this.wall) {
      new IntersectionObserver(([entry]) => {
        this.wallVisible = entry.isIntersecting;
        this.syncWall();
      }, { threshold: 0.1 }).observe(poster);
    }

    // The crate only turns on its own while it is on screen
    const hero = document.getElementById('landing-crate');
    if (hero) {
      new IntersectionObserver(([entry]) => { this.heroVisible = entry.isIntersecting; }).observe(hero);
    }
  }

  // Someone who has already connected a collection has no use for "try the demo" or "load my collection": the
  // first becomes a way back to their own crate, and the second goes away.
  applyState() {
    const connected = this.isConnected();
    this.root.querySelectorAll('[data-label-connected]').forEach((el) => {
      el.dataset.label ??= el.textContent.trim();
      el.textContent = connected ? el.dataset.labelConnected : el.dataset.label;
    });
    this.root.querySelectorAll('[data-landing-connect]').forEach((el) => {
      (el.closest('li') || el).hidden = connected;
    });
  }

  syncWall() {
    if (!this.wall) return;
    if (this.wallVisible && !this.root.hidden && !document.hidden) this.wall.start();
    else this.wall.stop();
  }

  // ---- Showing and hiding ------------------------------------------------------------------------------------------

  // route: also show /about in the address bar (when opened from Settings), so the address on screen is one worth sending
  show({ route = false } = {}) {
    if (!this.root) return;
    if (route && location.pathname !== '/about') history.replaceState(history.state, '', '/about');
    this.root.hidden = false;
    document.body.classList.add('landing-active');
    const appLayout = document.querySelector('.app-layout');
    if (appLayout) appLayout.style.display = 'none';
    window.scrollTo(0, 0);
    this.applyState();
    this.interacted = false;
    this.layout();
    this.startTimers();
    this.syncWall();
  }

  dismiss() {
    if (!this.root) return;
    try {
      localStorage.setItem('spindex_welcomed', '1');
      localStorage.setItem('spindex_entered_crate', '1');
    } catch {
      // Ignore storage restrictions
    }
    this.stopTimers();
    this.wall?.stop();
    this.root.hidden = true;
    document.body.classList.remove('landing-active');
    const appLayout = document.querySelector('.app-layout');
    if (appLayout) appLayout.style.display = '';
    // Leaving for the crate: the address bar should say so, or a reload would bring the home page back (an album link
    // that only led here has nothing to open, so it goes too)
    if (location.pathname === '/about' || location.pathname.startsWith('/album/') || new URLSearchParams(location.search).has('about')) {
      history.replaceState(history.state, '', '/');
    }
  }
}

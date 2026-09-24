// notes.js - Album inspector: the jacket, and everything printed inside and on the back of the sleeve
import { updateRecord, getRecord, getAllRecords } from './db.js';
import {
  groupTracksBySide,
  calculateTotalDuration,
  getRecordTags,
  tagLabel,
  groupCredits,
  creditKinds,
  loadRecordDetails,
  detailsAreStale,
  fetchArtistLinks,
} from './sync.js';
import { usefulValue } from './values.js';
import { fetchAlbumSections, fetchInfobox, fetchArtistBio, fetchBackCover, findAlbumPage, isVariousArtists } from './wiki.js';
import { isDiscogsConnected } from './discogs.js';
import { parseVinyl, vinylFill } from './vinyl.js';

// How long opening an album waits for its Discogs details before showing what it has
const SETTLE_MS = 600;

const COMPACT = '(max-width: 960px) and (min-height: 521px)';

export class GatefoldController {
  // onStep(direction): move the crate by one record and return the record now showing.
  // onJump(recordId): bring another record to the front of the crate and open it.
  // getPosition(): { index, total } of the record on show, for the "17 / 51" counter.
  // onRoute(record|null, mode): keep the address bar in step ('push' | 'replace' | 'close').
  constructor({ onStep, onJump, getPosition, onRoute } = {}) {
    this.onRoute = onRoute;
    this.onStep = onStep;
    this.onJump = onJump;
    this.getPosition = getPosition;
    this.activeRecord = null;
    this.renderToken = 0;

    const $ = (id) => document.getElementById(id);
    this.workspace = $('gatefold-workspace');
    this.backBtn = $('gatefold-back-btn');
    this.prevBtn = $('gf-prev-btn');
    this.nextBtn = $('gf-next-btn');
    this.stepCount = $('gf-step-count');
    this.right = $('gatefold-right');
    this.jacketWrap = $('gatefold-jacket-wrap');
    this.jacketArt = $('gatefold-jacket-art');
    this.backArt = $('gf-back-art');
    this.flipper = $('gf-flipper');
    this.flipBtn = $('gf-flip-btn');
    this.flipLabel = $('gf-flip-label');
    this.labelArt = $('gatefold-label-art');
    this.vinylDisc = $('gatefold-vinyl-disc');
    this.titleEl = $('gatefold-title');
    this.artistEl = $('gatefold-artist');
    this.specsEl = $('gf-specs');
    this.tagsEl = $('gf-tags');
    this.tracklistEl = $('gatefold-tracklist');
    this.creditsSection = $('gf-credits-section');
    this.creditsEl = $('gf-credits');
    this.wikiEl = $('gatefold-wiki');
    this.tracklistSection = $('gf-tracklist-section');
    this.storySection = $('gf-story-section');
    this.crateSection = $('gf-crate-section');
    this.connectionsEl = $('gf-connections');
    this.watchSection = $('gf-watch-section');
    this.videosEl = $('gf-videos');
    this.copySection = $('gf-copy-section');
    this.copyEl = $('gf-copy');
    this.bandSection = $('gf-band-section');
    this.bandEl = $('gf-band');
    this.bandTitle = $('gf-band-title');
    this.attributionEl = $('gf-attribution');
    this.attributionLink = $('gf-attribution-link');
    this.bar = document.querySelector('.gf-bar');
    this.barTitle = $('gf-bar-title');
    this.header = $('gf-header');
    this.tabsEl = $('gf-tabs');
    this.railEl = $('gf-rail');
    this.listenSection = $('gf-listen-section');
    this.listenLinksEl = $('gf-listen-links');
    this.navSignature = '';
    this.headerObserver = null;

    this.bindEvents();
  }

  bindEvents() {
    this.backBtn?.addEventListener('click', () => this.closeGatefold());
    this.prevBtn?.addEventListener('click', () => this.step(-1));
    this.nextBtn?.addEventListener('click', () => this.step(1));
    this.flipBtn?.addEventListener('click', () => this.toggleFlip());
    this.jacketWrap?.addEventListener('click', () => {
      this.toggleFlip();
    });

    // Delegated clicks for things rendered later: jumps into the crate and section links
    this.workspace?.addEventListener('click', (e) => {
      const jump = e.target.closest('[data-jump-id]');
      if (jump) {
        this.onJump?.(jump.dataset.jumpId);
        return;
      }
      const nav = e.target.closest('[data-target]');
      if (nav) this.scrollToSection(nav.dataset.target);
    });

    // Highlight the section being read; whichever element scrolls (sheet or right column) drives it
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        this.updateActiveSection();
      });
    };
    this.right?.addEventListener('scroll', onScroll, { passive: true });
    this.workspace?.addEventListener('scroll', onScroll, { passive: true });
    window.matchMedia(COMPACT).addEventListener('change', () => this.observeHeader());
    this.observePopIn();

    // Touch: swipe sideways for the next/previous record, pull down from the top to close
    let start = null;
    this.workspace?.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      // Not from the screen's edges (Safari's back swipe lives there) and not from the section tabs, which scroll sideways
      const nearEdge = t.clientX < 24 || t.clientX > window.innerWidth - 24;
      start = { x: t.clientX, y: t.clientY, scrollTop: this.scroller().scrollTop, inVideo: nearEdge || Boolean(e.target.closest('iframe, .gf-tabs')) };
    }, { passive: true });

    this.workspace?.addEventListener('touchend', (e) => {
      if (!start || start.inVideo) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) {
        this.step(dx < 0 ? 1 : -1);
      } else if (dy > 90 && dy > Math.abs(dx) * 1.5 && start.scrollTop === 0) {
        this.closeGatefold();
      }
      start = null;
    }, { passive: true });

    window.addEventListener('keydown', (e) => {
      if (!this.isOpen()) return;
      if (e.key === 'Escape') this.closeGatefold();
      else if (e.key === 'ArrowLeft') this.step(-1);
      else if (e.key === 'ArrowRight') this.step(1);
    });
  }

  isOpen() {
    return Boolean(this.workspace?.classList.contains('open'));
  }

  // Whichever element scrolls the content: the whole sheet on small screens, the right column on wide ones
  scroller() {
    return window.matchMedia(COMPACT).matches ? this.workspace : this.right;
  }

  // ------------------------------------------------------------------------
  // Open / close / step
  // ------------------------------------------------------------------------

  // mode: 'push' when coming from the crate, 'replace' when moving between records, 'none' for address-bar driven opens
  async openGatefold(record, mode = 'push') {
    const fresh = (await getRecord(record.id)) || record;
    this.activeRecord = fresh;
    const token = ++this.renderToken;

    // Details that are still missing shape the top of the page (label, producer, length). Give them a moment to arrive
    // so the page appears complete instead of growing in front of you.
    this.popInReady = false;
    clearTimeout(this.popInTimer);
    this.enrich(fresh, token);
    const first = this.detailsSettled;
    const waiting = !fresh.details && fresh.discogsId && isDiscogsConnected();
    const settle = () => Promise.race([first, new Promise((resolve) => setTimeout(resolve, SETTLE_MS))]);
    if (waiting && mode === 'replace') {
      await settle();
      if (this.renderToken !== token) return;
    }

    this.resetView();
    this.renderAll(fresh);
    if (mode !== 'none') this.onRoute?.(fresh, mode);
    if (waiting && mode !== 'replace') {
      await settle();
      if (this.renderToken !== token) return;
    }

    if (this.workspace) {
      // Arriving straight from an address (refresh, shared link) shows the page at once; only opening from the crate fades in
      if (mode === 'none') {
        this.workspace.classList.add('instant');
        setTimeout(() => this.workspace.classList.remove('instant'), 600);
      }
      this.workspace.classList.add('open');
      document.body.classList.add('sleeve-open');
      this.workspace.setAttribute('aria-hidden', 'false');
    }

    // Once the page has finished appearing, late arrivals fade in
    this.popInTimer = setTimeout(() => { this.popInReady = true; }, 500);

    // Trigger vinyl disc slide-out slightly after open
    setTimeout(() => {
      if (this.renderToken === token) this.vinylDisc?.classList.add('ejected');
    }, 180);

    this.observeHeader();
  }

  // silent: the address bar already changed (Back button), so don't touch it again
  closeGatefold(silent = false) {
    this.renderToken++;
    this.popInReady = false;
    this.vinylDisc?.classList.remove('ejected');
    if (this.workspace) {
      this.workspace.classList.remove('open');
      document.body.classList.remove('sleeve-open');
      this.workspace.setAttribute('aria-hidden', 'true');
    }
    this.headerObserver?.disconnect();
    if (!silent) this.onRoute?.(null, 'close');
  }

  async step(direction) {
    if (!this.isOpen() || !this.onStep) return;
    const next = this.onStep(direction);
    if (next && next.id !== this.activeRecord?.id) {
      this.vinylDisc?.classList.remove('ejected');
      await this.openGatefold(next, 'replace');
    }
  }

  resetView() {
    this.flipper?.classList.remove('is-flipped');
    this.jacketWrap?.classList.remove('disc-front');
    this.scroller().scrollTop = 0;
    if (this.right) this.right.scrollTop = 0;
    if (this.workspace) this.workspace.scrollTop = 0;
  }

  isCurrent(record, token) {
    return this.renderToken === token && this.activeRecord?.id === record.id;
  }

  async saveContext(record, patch) {
    record.context = { ...(record.context || {}), ...patch };
    await updateRecord(record.id, { context: record.context });
  }

  // ------------------------------------------------------------------------
  // Data: everything beyond what the crate already holds is fetched once, then kept on the record
  // ------------------------------------------------------------------------

  // The first phase decides the top of the page; the rest carries on behind it
  enrich(record, token) {
    const run = (fn) => fn().catch(() => { });

    // Release details and the Wikipedia context come first; the band and back cover build on them
    const details = run(() => this.loadDetails(record, token));
    const first = Promise.all([details, run(() => this.loadStory(record, token))]);
    this.detailsSettled = details;
    first.then(() => Promise.all([
      run(() => this.loadBand(record, token)),
      run(() => this.loadBackCover(record, token)),
      run(() => this.loadListen(record, token)),
    ]));
    return first;
  }

  // A Deezer page for the album, when Deezer has it (checked once, then kept on the record)
  async loadListen(record, token) {
    if (record.context?.listen === undefined) {
      try {
        const res = await fetch(`/api/listen/deezer?artist=${encodeURIComponent(record.artist || '')}&title=${encodeURIComponent(record.title || '')}`);
        if (res.ok) await this.saveContext(record, { listen: { deezer: (await res.json()).url || null } });
      } catch {
        // No server functions here, or offline: try again next time
      }
    }
    if (this.isCurrent(record, token)) this.renderListen(record);
  }

  async loadDetails(record, token) {
    if (record.discogsId && isDiscogsConnected()) {
      if (!record.details) {
        const updates = await loadRecordDetails(record);
        if (updates) Object.assign(record, updates);
      } else if (detailsAreStale(record)) {
        // Refresh in the background and keep it for next time; the page in front of you doesn't change under you
        loadRecordDetails(record, 'low').catch(() => { });
      }
    }
    if (this.isCurrent(record, token)) this.renderAll(record);
  }

  async loadStory(record, token) {
    // matchVersion 2: the article must actually be this album. Older matches (often a wrong page) are looked up again.
    if (!record.context || record.context.matchVersion !== 2) {
      await this.fetchLinerNotes(record);
    } else if (!record.context.releaseChecked && (!record.releaseDate || record.year === record.pressingYear)) {
      await this.resolveStructuredReleaseDate(record, record.context.wikiTitle || null);
      await this.saveContext(record, { releaseChecked: true });
    }
    if (this.isCurrent(record, token)) this.renderAll(record);

    const wikiTitle = record.context?.wikiTitle;
    if (wikiTitle && !record.context.sectionsFetched) {
      const [sections, infobox] = await Promise.all([fetchAlbumSections(wikiTitle), fetchInfobox(wikiTitle)]);
      await this.saveContext(record, { sections, infobox, sectionsFetched: true });
      if (this.isCurrent(record, token)) this.renderAll(record);
    }
  }

  async loadBand(record, token) {
    // Version 2 = title-search lookup with Wikidata links; anything cached before that is refreshed once
    if (isVariousArtists(record.artist)) {
      if (record.context?.artistBioChecked !== 2) await this.saveContext(record, { artistBio: null, artistBioChecked: 2, artistLinks: null });
      if (this.isCurrent(record, token)) this.renderBand(record);
      return;
    }
    if (record.context?.artistBioChecked !== 2) {
      const bio = await fetchArtistBio(record.artist);
      // undefined means Wikipedia was unreachable: leave it unchecked so the next open tries again
      if (bio !== undefined) await this.saveContext(record, { artistBio: bio, artistBioChecked: 2 });
    }

    // Official site, YouTube, Bandcamp... from the artist's Discogs profile
    const artistId = record.details?.artists?.[0]?.id;
    if (artistId && isDiscogsConnected() && record.context?.artistLinks === undefined) {
      const urls = await fetchArtistLinks(artistId);
      if (urls) await this.saveContext(record, { artistLinks: urls });
    }
    if (this.isCurrent(record, token)) this.renderBand(record);
  }

  async loadBackCover(record, token) {
    // backCoverVersion 2: chosen by format (vinyl, then CD). Covers saved before that could be a cassette insert.
    if (record.context?.backCover === undefined || record.context.backCoverVersion !== 2) {
      const url = isVariousArtists(record.artist) ? null : await fetchBackCover(record.artist, record.title);
      await this.saveContext(record, { backCover: url || null, backCoverVersion: 2 });
    }
    if (this.isCurrent(record, token)) this.renderFlip(record);
  }

  // ------------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------------

  // Each section renders on its own: if one fails on an odd record, the rest of the page still appears
  renderAll(record) {
    const steps = [
      'renderFront', 'renderSpecs', 'renderTracklist', 'renderCredits', 'renderStory', 'renderVideos', 'renderListen',
      'renderCopy', 'renderBand', 'renderAttribution', 'renderFlip', 'renderConnections', 'renderNav',
    ];
    for (const step of steps) {
      try {
        const result = this[step](record);
        if (result && typeof result.catch === 'function') result.catch((err) => console.error(`Album page: ${step} failed`, err));
      } catch (err) {
        console.error(`Album page: ${step} failed`, err);
      }
    }
  }

  renderFront(record) {
    const artUrl = record.artwork?.highRes || record.artwork?.thumbnail || '';
    if (this.jacketArt && this.jacketArt.getAttribute('src') !== artUrl) {
      this.jacketArt.src = artUrl;
    }
    if (this.jacketArt) this.jacketArt.alt = `${record.artist} – ${record.title}`;
    if (this.labelArt && this.labelArt.getAttribute('src') !== artUrl) this.labelArt.src = artUrl;
    this.applyVinyl(record, artUrl);
    if (this.titleEl) this.titleEl.textContent = record.title || '';
    if (this.artistEl) this.artistEl.textContent = record.artist || '';

    const pos = this.getPosition?.();
    if (this.stepCount && pos) this.stepCount.textContent = `${pos.index + 1} / ${pos.total}`;
  }

  // The record peeking out of the jacket takes the colour and finish of the pressing (Discogs: format text)
  applyVinyl(record, artUrl) {
    if (!this.vinylDisc) return;
    try {
      const look = parseVinyl(record.details?.formats);
      // Groove rings over the pressing's colour, as one plain inline background (the widest-supported gradient syntax)
      const grooves = 'repeating-radial-gradient(circle, rgba(0, 0, 0, 0.3) 0px, rgba(0, 0, 0, 0.3) 1px, rgba(255, 255, 255, 0.05) 1px, rgba(255, 255, 255, 0.05) 2px, rgba(0, 0, 0, 0) 2px, rgba(0, 0, 0, 0) 4px)';
      if (look.kind === 'black') {
        this.vinylDisc.style.removeProperty('background'); // the standard black record from the stylesheet
      } else {
        this.vinylDisc.style.background = `${grooves}, ${vinylFill(look, artUrl)}`;
      }
      this.vinylDisc.dataset.finish = look.kind;
    } catch (err) {
      console.error('Album page: could not colour the record', err);
      this.vinylDisc.style.removeProperty('background');
    }
  }

  formatDate(record) {
    if (record.releaseDate) {
      const d = new Date(record.releaseDate);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      }
    }
    const divergent = Boolean(record.year && record.masterYear && record.year !== record.masterYear);
    const year = divergent ? record.year : (record.masterYear || record.originalYear || record.year);
    return year ? String(year) : '';
  }

  producers(record) {
    const groups = groupCredits(record.details);
    const production = groups.find((g) => g.title === 'Produced & engineered');
    const names = (production?.people || [])
      .filter((p) => p.roles.some((r) => /^(co-?)?producer$/i.test(r)))
      .map((p) => p.name);
    if (names.length > 0) return names.slice(0, 3).join(', ');
    return record.context?.infobox?.producer || '';
  }

  renderSpecs(record) {
    const label = record.details?.labels?.[0];
    const rows = [
      ['Released', this.formatDate(record)],
      ['Label', usefulValue(label?.name) || usefulValue(record.context?.infobox?.label)],
      ['Length', calculateTotalDuration(record.tracklist) || ''],
      ['Produced by', this.producers(record)],
    ].filter(([, value]) => value);

    if (this.specsEl) {
      this.specsEl.innerHTML =  /*html*/ rows
        .map(([k, v]) => `<div class="gf-spec"><dt>${this.escapeHTML(k)}</dt><dd>${this.escapeHTML(v)}</dd></div>`)
        .join('');
    }

    if (this.tagsEl) {
      const tags = getRecordTags(record).slice(0, 5);
      this.tagsEl.innerHTML =  /*html*/ tags.map((t) => `<span class="gf-tag">${this.escapeHTML(tagLabel(t))}</span>`).join('');
    }
  }

  lyricsUrl(record, track) {
    return `https://genius.com/search?q=${encodeURIComponent(`${record.artist} ${track.title}`)}`;
  }

  renderTracklist(record) {
    if (!this.tracklistEl) return;
    const tracks = record.tracklist || [];
    if (this.tracklistSection) this.tracklistSection.hidden = tracks.length === 0;
    if (tracks.length === 0) return;

    const row = (t) => `<li><span class="gf-tpos">${this.escapeHTML(t.position || '·')}</span><span class="gf-tname">${this.escapeHTML(t.title)}</span><span class="gf-ttime">${this.escapeHTML(t.duration || '')}</span><a class="gf-lyrics" href="${this.escapeHTML(this.lyricsUrl(record, t))}" target="_blank" rel="noopener" aria-label="Search lyrics for ${this.escapeHTML(t.title)}" title="Find lyrics on Genius">↗</a></li>`;

    const sides = groupTracksBySide(tracks);
    if (sides && sides.length > 0) {
      const cols = sides.map((side) => `<div class="gatefold-side-col"><div class="gatefold-side-hdr">${this.escapeHTML(side.title)}</div><ul class="gatefold-tracks">${side.tracks.map(row).join('')}</ul></div>`);
      this.tracklistEl.innerHTML =  /*html*/ `<div class="gatefold-sides-grid">${cols.join('')}</div>`;
    } else {
      this.tracklistEl.innerHTML =  /*html*/ `<ul class="gatefold-tracks">${tracks.map(row).join('')}</ul>`;
    }
  }

  renderCredits(record) {
    if (!this.creditsSection || !this.creditsEl) return;
    const groups = groupCredits(record.details);
    this.creditsSection.hidden = groups.length === 0;
    if (groups.length === 0) return;

    const person = (p) => `<li><span class="gf-credit-name">${this.escapeHTML(p.name)}</span><span class="gf-credit-role">${this.escapeHTML(p.roles.join(', '))}</span></li>`;
    const html = groups.map((g) => {
      const shown = g.people.slice(0, 8).map(person).join('');
      const rest = g.people.slice(8);
      const more = rest.length > 0
        ? `<li class="gf-more-item"><details class="gf-more"><summary>+ ${rest.length} more</summary><ul>${rest.map(person).join('')}</ul></details></li>`
        : '';
      return `<div class="gf-credit-group"><h4>${this.escapeHTML(g.title)}</h4><ul>${shown}${more}</ul></div>`;
    });
    this.creditsEl.innerHTML =  /*html*/ html.join('');
  }

  renderStory(record) {
    if (!this.wikiEl) return;
    const ctx = record.context;
    // Nothing to show (still looking, or no article): the section stays out of the way
    if (this.storySection) this.storySection.hidden = !ctx?.wikiExtract;
    if (!ctx?.wikiExtract) return;

    const paragraphs = (text) => text.split('\n\n').map((p) => `<p>${this.escapeHTML(p)}</p>`).join('');
    const parts = [`<div class="gf-lede">${ctx.wikiExtract}</div>`];
    if (ctx.sections?.background) {
      parts.push(`<h4 class="gf-prose-head">${this.escapeHTML(ctx.sections.background.heading)}</h4>${paragraphs(ctx.sections.background.text)}`);
    }
    if (ctx.sections?.reception) {
      parts.push(`<h4 class="gf-prose-head">${this.escapeHTML(ctx.sections.reception.heading)}</h4>${paragraphs(ctx.sections.reception.text)}`);
    }
    if (ctx.wikiUrl) {
      parts.push(`<p class="gf-source">From <a href="${this.escapeHTML(ctx.wikiUrl)}" target="_blank" rel="noopener">Wikipedia</a>, under CC BY-SA.</p>`);
    }
    this.wikiEl.innerHTML =  /*html*/ parts.join('');
  }

  // Places to hear the album: only links known to land on it (never a search page)
  renderListen(record) {
    if (!this.listenSection || !this.listenLinksEl) return;
    const links = [
      record.itunesUrl && { name: 'Apple Music', url: record.itunesUrl },
      record.context?.listen?.deezer && { name: 'Deezer', url: record.context.listen.deezer },
    ].filter(Boolean);
    this.listenSection.hidden = links.length === 0;
    if (links.length === 0) return;

    const item = (l) => `<li><a href="${this.escapeHTML(l.url)}" target="_blank" rel="noopener"><span class="gf-link-name">${l.name}</span></a></li>`;
    this.listenLinksEl.innerHTML =  /*html*/ `<div class="gf-links-row is-bare"><ul>${links.map(item).join('')}</ul></div>`;
  }

  // Videos open on YouTube: many music videos forbid embedding, and a player that silently fails is worse than a link
  renderVideos(record) {
    if (!this.watchSection || !this.videosEl) return;
    const videos = (record.details?.videos || []).slice(0, 3);
    this.watchSection.hidden = videos.length === 0;
    if (videos.length === 0) return;

    this.videosEl.innerHTML =  /*html*/ videos.map((v) => `
      <a class="gf-video" href="https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}" target="_blank" rel="noopener">
        <span class="gf-video-thumb"><img src="https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/mqdefault.jpg" alt="" /><span class="gf-video-play"></span></span>
        <span class="gf-video-title">${this.escapeHTML(v.title)}</span>
        <span class="gf-video-source">Watch on YouTube <span aria-hidden="true">↗</span></span>
      </a>`).join('');
    // A blocked or missing thumbnail leaves the dark card with its play mark rather than a broken image
    this.videosEl.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => img.remove()));
  }

  // "Your copy": the pressing you own, then how you keep it. Kept apart from facts about the album itself.
  renderCopy(record) {
    if (!this.copySection || !this.copyEl) return;
    const d = record.details;
    const dl = (rows) => rows.length
      ? `<dl class="gf-copy-rows">${rows.map(([k, v, mono]) => `<div><dt>${this.escapeHTML(k)}</dt><dd${mono ? ' class="is-mono"' : ''}>${this.escapeHTML(v)}</dd></div>`).join('')}</dl>`
      : '';

    // The pressing
    const pressing = [];
    if (d?.formats?.length) {
      const f = d.formats[0];
      const bits = [f.name, ...(f.descriptions || []), f.text].filter(Boolean);
      pressing.push(['Format', (Number(f.qty) > 1 ? `${f.qty} × ` : '') + bits.join(' · ')]);
    }
    let pressed = d?.released || (record.pressingYear ? String(record.pressingYear) : '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(pressed)) {
      pressed = new Date(`${pressed}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    } else if (/^\d{4}-\d{2}$/.test(pressed)) {
      pressed = new Date(`${pressed}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    }
    if (pressed) pressing.push(['Pressed', pressed]);
    if (d?.country) pressing.push(['Country', d.country]);
    if (d?.labels?.length) {
      pressing.push(['Label', d.labels.map((l) => (l.catno ? `${l.name} — ${l.catno}` : l.name)).join('\n')]);
    }
    for (const id of d?.identifiers || []) {
      pressing.push([id.type === 'Barcode' ? 'Barcode' : `Runout${id.description ? ` (${id.description})` : ''}`, id.value, true]);
    }
    for (const c of (d?.companies || []).filter((c) => /pressed|lacquer|mastered|recorded|manufactured|mixed|engineered/i.test(c.role)).slice(0, 6)) {
      pressing.push([c.role, c.name]);
    }

    // How it lives in your crate: grades and notes come from your Discogs collection fields
    const yours = [];
    if (record.mediaCondition) yours.push(['Media', record.mediaCondition]);
    if (record.sleeveCondition) yours.push(['Sleeve', record.sleeveCondition]);
    for (const n of record.collectionNotes || []) yours.push([n.name, n.value]);
    if (record.dateAdded) {
      const added = new Date(record.dateAdded);
      if (!Number.isNaN(added.getTime())) {
        yours.push(['Added', added.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })]);
      }
    }

    const parts = [];
    if (pressing.length) parts.push(`<div class="gf-copy-group"><h4>This pressing</h4>${dl(pressing)}</div>`);
    if (yours.length) parts.push(`<div class="gf-copy-group"><h4>In your crate</h4>${dl(yours)}</div>`);
    if (d?.notes) {
      parts.push(`<details class="gf-release-notes"><summary>Notes on this release</summary><p>${this.escapeHTML(d.notes)}</p></details>`);
    }
    if (record.discogsId && !String(record.id).startsWith('discogs_mock_')) {
      parts.push(`<a class="gf-inline-link" href="https://www.discogs.com/release/${encodeURIComponent(record.discogsId)}" target="_blank" rel="noopener">View this pressing on Discogs <span aria-hidden="true">↗</span></a>`);
    }

    this.copySection.hidden = parts.length === 0;
    this.copyEl.innerHTML =  /*html*/ parts.join('');
  }

  // The artist: bio, a freely licensed portrait, and links that say where they lead
  renderBand(record) {
    if (!this.bandSection || !this.bandEl) return;
    // "Various" isn't a band: nothing to say about them, and no page to link to
    if (isVariousArtists(record.artist)) {
      this.bandSection.hidden = true;
      return;
    }
    const bio = record.context?.artistBio;
    const safe = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
    const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

    // A group is "the band"; a person is "the artist"
    const isGroup = /\b(band|group|duo|trio|quartet|quintet|ensemble|collective|orchestra)\b/i.test(bio?.description || '');
    const heading = isGroup ? 'The artist' : 'The artist';
    if (this.bandTitle) this.bandTitle.textContent = heading;
    this.bandSection.dataset.nav = heading;

    // Where to follow the artist, and where to read or listen. Each link says something the label alone doesn't:
    // a handle, a domain that's theirs, or nothing at all when the name is enough.
    const follow = [];
    const has = (kind) => follow.some((l) => l.kind === kind);
    const addFollow = (kind, label, url, handle = '') => { if (url && !has(kind)) follow.push({ kind, label, url, handle }); };

    const discogsUrls = (record.context?.artistLinks || []).map(safe).filter(Boolean);
    const fromDiscogs = (kind) => discogsUrls.find((u) => {
      const h = host(u);
      if (kind === 'instagram') return /instagram\.com/.test(h);
      if (kind === 'youtube') return /youtube\.com|youtu\.be/.test(h);
      if (kind === 'bandcamp') return /bandcamp\.com/.test(h);
      if (kind === 'website') return !/wikipedia|discogs|allmusic|musicbrainz|last\.fm|soundcloud|spotify|apple|itunes|myspace|genius|rateyourmusic|bbc|imdb|wikidata|amazon|facebook|twitter|x\.com|tiktok|threads|instagram|youtube|youtu\.be|bandcamp/.test(h);
      return false;
    });
    const pathHandle = (u) => { try { return new URL(u).pathname.split('/').filter(Boolean)[0] || ''; } catch { return ''; } };
    const wd = bio?.links || {};

    const website = fromDiscogs('website') || safe(wd.website);
    addFollow('website', 'Official site', website, website ? host(website) : '');

    const ig = fromDiscogs('instagram') || (wd.instagram ? `https://www.instagram.com/${encodeURIComponent(wd.instagram)}/` : '');
    addFollow('instagram', 'Instagram', ig, ig ? `@${pathHandle(ig)}` : '');

    const yt = fromDiscogs('youtube') || (wd.youtubeChannel ? `https://www.youtube.com/channel/${encodeURIComponent(wd.youtubeChannel)}` : '');
    const ytHandle = yt && /\/@/.test(yt) ? decodeURIComponent(yt.split('/').filter(Boolean).pop()) : '';
    addFollow('youtube', 'YouTube', yt, ytHandle);

    const bc = fromDiscogs('bandcamp');
    addFollow('bandcamp', 'Bandcamp', bc, bc ? host(bc).replace(/\.bandcamp\.com$/, '') : '');

    const sc = wd.soundcloud ? `https://soundcloud.com/${encodeURIComponent(wd.soundcloud)}` : '';
    addFollow('soundcloud', 'SoundCloud', sc, wd.soundcloud ? `@${wd.soundcloud}` : '');

    const more = [];
    if (bio?.url) more.push({ label: 'Wikipedia', url: bio.url });
    if (record.itunesArtistUrl) more.push({ label: 'Apple Music', url: record.itunesArtistUrl });
    const discogsArtistId = record.details?.artists?.[0]?.id || wd.discogsId;
    if (discogsArtistId) more.push({ label: 'Discogs', url: `https://www.discogs.com/artist/${discogsArtistId}` });
    if (wd.musicbrainzId) more.push({ label: 'MusicBrainz', url: `https://musicbrainz.org/artist/${wd.musicbrainzId}` });

    const links = [...follow, ...more];

    this.bandSection.hidden = !bio && links.length === 0;
    if (this.bandSection.hidden) return;

    const photo = bio?.photo;
    const photoHTML = photo ? `<figure class="gf-band-photo"><img src="${this.escapeHTML(photo.url)}" alt="${this.escapeHTML(record.artist)}" /><figcaption>Photo: ${this.escapeHTML(photo.author)}${photo.license ? `, ${this.escapeHTML(photo.license)}` : ''} · <a href="${this.escapeHTML(photo.page)}" target="_blank" rel="noopener">Wikimedia Commons</a></figcaption></figure>` : '';
    const bioHTML = bio ? `<p class="gf-band-bio">${this.escapeHTML(bio.extract)}</p>` : '';
    const linkHTML = (l) => `<li><a href="${this.escapeHTML(l.url)}" target="_blank" rel="noopener"><span class="gf-link-name">${this.escapeHTML(l.label)}</span>${l.handle ? `<span class="gf-link-handle">${this.escapeHTML(l.handle)}</span>` : ''}</a></li>`;
    const row = (label, items) => (items.length ? `<div class="gf-links-row"><span class="gf-links-label">${label}</span><ul>${items.map(linkHTML).join('')}</ul></div>` : '');
    const linksHTML = links.length ? `<div class="gf-links">${row('Follow', follow)}${row('Read &amp; listen', more)}</div>` : '';

    this.bandEl.classList.toggle('has-photo', Boolean(photo));
    this.bandEl.innerHTML =  /*html*/ `${photoHTML}<div class="gf-band-text">${bioHTML}${linksHTML}</div>`;
    // If the portrait can't load, drop the whole figure so no empty column is left behind
    const img = this.bandEl.querySelector('.gf-band-photo img');
    img?.addEventListener('error', () => {
      this.bandEl.querySelector('.gf-band-photo')?.remove();
      this.bandEl.classList.remove('has-photo');
    });
  }

  // Discogs' terms: credit them next to their data, linking to the page that holds it (a normal, followed link)
  renderAttribution(record) {
    if (!this.attributionEl) return;
    const fromDiscogs = record.discogsId && !String(record.id).startsWith('discogs_mock_');
    this.attributionEl.hidden = !fromDiscogs;
    if (fromDiscogs && this.attributionLink) {
      this.attributionLink.href = `https://www.discogs.com/release/${encodeURIComponent(record.discogsId)}`;
    }
  }

  hasBackCover() {
    return Boolean(this.activeRecord?.context?.backCover);
  }

  // The sleeve always flips: it's how you see the whole record. Until (or unless) a real back cover turns up, the
  // back is the front art, dimmed.
  renderFlip(record) {
    const back = record.context?.backCover;
    const frontArt = record.artwork?.highRes || record.artwork?.thumbnail || '';
    const src = back || frontArt;
    if (this.backArt) {
      if (src && this.backArt.getAttribute('src') !== src) this.backArt.src = src;
      this.backArt.alt = back ? `${record.artist} – ${record.title}, back cover` : '';
      this.backArt.closest('.gf-back')?.classList.toggle('is-placeholder', !back);
    }
    if (this.flipBtn) this.flipBtn.hidden = false;
    this.jacketWrap?.classList.add('is-flippable');
    this.updateFlipLabel();
    this.syncDiscFront();
  }

  updateFlipLabel() {
    if (!this.flipLabel) return;
    const flipped = this.flipper?.classList.contains('is-flipped');
    if (flipped) this.flipLabel.textContent = 'Flip to front cover';
    else this.flipLabel.textContent = this.hasBackCover() ? 'Flip to back cover' : 'Flip the sleeve';
  }

  toggleFlip() {
    this.flipper.classList.toggle('is-flipped');
    this.updateFlipLabel();
    this.syncDiscFront();
  }

  // With no back cover to look at, the flipped sleeve makes room for the record, which slides in front of it
  syncDiscFront() {
    const flipped = this.flipper?.classList.contains('is-flipped');
    this.jacketWrap?.classList.toggle('disc-front', Boolean(flipped && !this.hasBackCover()));
  }

  // Other records in your crate, in this order of relevance: same artist, shared writer, shared producer, same label.
  // Each record is listed once, under its strongest tie, and it's fine if fewer than six qualify.
  async renderConnections(record) {
    if (!this.crateSection || !this.connectionsEl) return;
    const token = this.renderToken;
    const all = await getAllRecords();
    if (this.renderToken !== token) return;

    const peopleByKind = (rec) => {
      const map = { writer: new Map(), producer: new Map() };
      for (const c of rec.details?.credits || []) {
        if (!c.id) continue;
        for (const kind of creditKinds(c.role)) map[kind].set(c.id, c.name);
      }
      return map;
    };

    const mine = peopleByKind(record);
    const myArtistIds = new Set((record.details?.artists || []).map((a) => a.id));
    const myLabels = new Set((record.details?.labels || []).map((l) => l.name.toLowerCase()));

    const found = [];
    for (const other of all) {
      if (other.id === record.id) continue;

      let tier = 0;
      let reason = '';
      const sameArtist = !isVariousArtists(record.artist) && (other.artist === record.artist ||
        (other.details?.artists || []).some((a) => myArtistIds.has(a.id)));

      if (sameArtist) {
        tier = 1;
        reason = record.artist;
      } else {
        const theirs = peopleByKind(other);
        for (const [t, kind, verb] of [[2, 'writer', 'Written by'], [3, 'producer', 'Produced by']]) {
          const names = [...mine[kind]].filter(([id]) => theirs[kind].has(id)).map(([, name]) => name);
          if (names.length > 0) {
            tier = t;
            reason = `${verb} ${names.slice(0, 2).join(' & ')}`;
            break;
          }
        }
        if (!tier) {
          const label = (other.details?.labels || []).find((l) => myLabels.has(l.name.toLowerCase()));
          if (label) { tier = 4; reason = `Also on ${label.name}`; }
        }
      }
      if (tier) found.push({ other, tier, reason });
    }

    found.sort((a, b) => a.tier - b.tier || (a.other.title || '').localeCompare(b.other.title || ''));
    const top = found.slice(0, 6);
    this.crateSection.hidden = top.length === 0;
    if (top.length === 0) { this.renderNav(); return; }

    this.connectionsEl.innerHTML =  /*html*/ top.map(({ other, reason }) => `
      <button class="gf-connection" data-jump-id="${this.escapeHTML(other.id)}">
        <img src="${this.escapeHTML(other.artwork?.thumbnail || '')}" alt="" />
        <span class="gf-connection-text">
          <span class="gf-connection-title">${this.escapeHTML(other.title)}</span>
          <span class="gf-connection-artist">${this.escapeHTML(other.artist)}</span>
          <span class="gf-connection-why">${this.escapeHTML(reason)}</span>
        </span>
      </button>`).join('');
    this.renderNav();
  }

  // ------------------------------------------------------------------------
  // Sticky title + section navigation
  // ------------------------------------------------------------------------

  // Once the big title has scrolled away, the bar carries "Title · Artist" instead
  // Anything that arrives after the page has finished opening (details, Wikipedia text, links) fades in instead of
  // popping. Content that is re-rendered unchanged is left alone.
  observePopIn() {
    if (!this.workspace || typeof MutationObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // A node's markup without any fade class it may be carrying, so a re-render of the same content compares equal
    const signature = (node) => {
      if (!(node instanceof HTMLElement)) return null;
      const copy = node.cloneNode(true);
      for (const el of [copy, ...copy.querySelectorAll('.pop-in')]) {
        el.classList.remove('pop-in');
        if (!el.getAttribute('class')) el.removeAttribute('class');
      }
      return copy.outerHTML;
    };

    const fade = (el) => {
      if (!(el instanceof HTMLElement) || el.closest('.pop-in')) return;
      el.classList.add('pop-in');
      // animationend can be skipped (background tab), so a timer clears the class too
      const clear = () => el.classList.remove('pop-in');
      el.addEventListener('animationend', clear, { once: true });
      setTimeout(clear, 600);
    };

    new MutationObserver((records) => {
      if (!this.popInReady) return;
      for (const record of records) {
        if (record.type === 'attributes') {
          // A section that was hidden and now has something to show
          if (record.oldValue !== null && !record.target.hidden) fade(record.target);
          continue;
        }
        const before = new Set([...record.removedNodes].map(signature));
        for (const node of record.addedNodes) {
          if (!before.has(signature(node))) fade(node);
        }
      }
    }).observe(this.workspace, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'], attributeOldValue: true });
  }

  observeHeader() {
    this.headerObserver?.disconnect();
    if (!this.header || !this.bar || !this.isOpen()) return;

    if (this.barTitle && this.activeRecord) {
      this.barTitle.textContent = `${this.activeRecord.title} · ${this.activeRecord.artist}`;
    }
    this.headerObserver = new IntersectionObserver(([entry]) => {
      this.bar.classList.toggle('is-scrolled', !entry.isIntersecting);
    }, { root: this.scroller(), rootMargin: '-64px 0px 0px 0px', threshold: 0 });
    this.headerObserver.observe(this.header);
    this.bar.classList.remove('is-scrolled');
  }

  // Scroll only the inspector's own scroller. scrollIntoView() would also scroll clipped ancestors and shove the whole app upward.
  scrollToSection(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const scroller = this.scroller();
    const compact = window.matchMedia(COMPACT).matches;
    const offset = compact ? (this.bar?.offsetHeight || 96) + 16 : 24;
    const top = scroller.scrollTop + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset;
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  visibleSections() {
    return [...(this.right?.querySelectorAll('.gf-section[data-nav]') || [])].filter((el) => !el.hidden);
  }

  // The list of sections is the table of contents; rebuilt only when the set of visible sections changes
  renderNav() {
    const sections = this.visibleSections();
    const signature = sections.map((el) => `${el.id}:${el.dataset.nav}`).join('|');
    if (signature === this.navSignature) return;
    this.navSignature = signature;

    const html = sections.map((el) => `<button type="button" data-target="${this.escapeHTML(el.id)}">${this.escapeHTML(el.dataset.nav)}</button>`).join('');
    if (this.railEl) this.railEl.innerHTML =  /*html*/ html;
    if (this.tabsEl) this.tabsEl.innerHTML =  /*html*/ html;
    this.updateActiveSection();
  }

  updateActiveSection() {
    const sections = this.visibleSections();
    if (sections.length === 0) return;

    const scroller = this.scroller();
    const top = scroller.getBoundingClientRect().top + (window.matchMedia(COMPACT).matches ? 110 : 140);
    let active = sections[0];
    for (const el of sections) {
      if (el.getBoundingClientRect().top <= top) active = el;
    }
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) active = sections[sections.length - 1];

    for (const nav of [this.railEl, this.tabsEl]) {
      nav?.querySelectorAll('[data-target]').forEach((b) => {
        const on = b.dataset.target === active.id;
        b.classList.toggle('active', on);
        if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      });
    }
    // Keep the active tab in view on phones
    const tab = this.tabsEl?.querySelector('.active');
    if (tab && this.tabsEl.scrollWidth > this.tabsEl.clientWidth) {
      this.tabsEl.scrollTo({ left: tab.offsetLeft - 24, behavior: 'smooth' });
    }
  }

  // ------------------------------------------------------------------------
  // Wikipedia summary + release date (unchanged behavior)
  // ------------------------------------------------------------------------

  async fetchLinerNotes(record) {
    // What we learned elsewhere (artist bio, back cover...) survives; only the album-article fields are redone
    const WIKI_FIELDS = ['wikiExtract', 'wikiDescription', 'wikiUrl', 'wikiImage', 'wikiTitle', 'sections', 'infobox', 'sectionsFetched', 'releaseChecked'];
    const kept = Object.fromEntries(Object.entries(record.context || {}).filter(([k]) => !WIKI_FIELDS.includes(k)));

    try {
      const titleToFetch = await findAlbumPage(record.artist, record.title);
      if (titleToFetch === undefined) return;
      if (titleToFetch === null) {
        const context = { ...kept, matchVersion: 2, releaseChecked: true };
        await updateRecord(record.id, { context });
        record.context = context;
        return;
      }

      const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titleToFetch)}`);
      if (!res.ok) throw new Error('No summary found');

      const data = await res.json();
      const context = {
        wikiExtract: data.extract_html || `<p>${this.escapeHTML(data.extract || '')}</p>`,
        wikiDescription: data.description || '',
        wikiUrl: data.content_urls?.desktop?.page || '',
        wikiImage: data.originalimage?.source || data.thumbnail?.source || null,
        wikiTitle: titleToFetch,
        ...kept,
        matchVersion: 2,
      };

      await updateRecord(record.id, { context });
      record.context = context;

      await this.resolveStructuredReleaseDate(record, titleToFetch);
    } catch {
      // No summary found; the story section says so
    }
  }

  async resolveStructuredReleaseDate(record, wikiTitle) {
    let resolvedDate = null;
    let resolvedYear = null;

    // 1. Check Wikipedia wikitext infobox `| released =`
    if (wikiTitle) {
      try {
        const parseUrl = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(wikiTitle)}&prop=wikitext&format=json&origin=*`;
        const parseRes = await fetch(parseUrl);
        if (parseRes.ok) {
          const parseData = await parseRes.json();
          const wikitext = parseData?.parse?.wikitext?.['*'] || '';
          const m = wikitext.match(/\|\s*released\s*=\s*(.+?)(?=\n\s*\||\n\s*\}\}|$)/is);
          if (m) {
            let raw = m[1].trim();
            raw = raw.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '').replace(/<ref\b[^>]*\/>/gi, '').trim();

            const startDateMatch = raw.match(/\{\{Start date(?: and age)?\|(\d{4})\|(\d{1,2})\|(\d{1,2})/i);
            if (startDateMatch) {
              const y = parseInt(startDateMatch[1], 10);
              const mo = startDateMatch[2].padStart(2, '0');
              const d = startDateMatch[3].padStart(2, '0');
              resolvedYear = y;
              resolvedDate = `${y}-${mo}-${d}T00:00:00.000Z`;
            } else {
              const cleanStr = raw.replace(/<[^>]+>/g, '').replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1').trim();
              const parsed = new Date(cleanStr);
              if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 1900 && parsed.getFullYear() <= 2030) {
                resolvedYear = parsed.getFullYear();
                resolvedDate = parsed.toISOString();
              } else {
                const yearMatch = cleanStr.match(/\b(19\d{2}|20\d{2})\b/);
                if (yearMatch) {
                  resolvedYear = parseInt(yearMatch[1], 10);
                }
              }
            }
          }
        }
      } catch {
        // Fall through to MusicBrainz
      }
    }

    // 2. Structured fallback: MusicBrainz Release Group (open, structured music catalog)
    if (!resolvedYear && record.artist && record.title) {
      try {
        const cleanTitle = record.title.replace(/\([^)]*\)/g, '').trim();
        const mbUrl = `https://musicbrainz.org/ws/2/release-group?query=artist:${encodeURIComponent(record.artist)}+AND+releasegroup:${encodeURIComponent(cleanTitle)}&fmt=json`;
        const mbRes = await fetch(mbUrl);
        if (mbRes.ok) {
          const mbData = await mbRes.json();
          const groups = mbData?.['release-groups'] || [];
          if (groups.length > 0 && groups[0]['first-release-date']) {
            const firstDateStr = groups[0]['first-release-date'];
            const yearMatch = firstDateStr.match(/^(\d{4})/);
            if (yearMatch) {
              resolvedYear = parseInt(yearMatch[1], 10);
              const parsed = new Date(firstDateStr);
              if (!isNaN(parsed.getTime())) {
                resolvedDate = parsed.toISOString();
              }
            }
          }
        }
      } catch {
        // Ignore MusicBrainz failure
      }
    }

    // 3. Fallback: Parse description year (e.g. "2003 studio album by AFI")
    if (!resolvedYear && record.context?.wikiDescription) {
      const descMatch = record.context.wikiDescription.match(/\b(19\d{2}|20\d{2})\b/);
      if (descMatch) {
        resolvedYear = parseInt(descMatch[1], 10);
      }
    }

    if (resolvedYear) {
      const updates = {
        originalYear: resolvedYear,
        year: resolvedYear,
      };
      if (resolvedDate) {
        updates.releaseDate = resolvedDate;
      }

      await updateRecord(record.id, updates);
      Object.assign(record, updates);
    }
  }

  escapeHTML(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

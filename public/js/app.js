// app.js - Main application coordinator
import { openDB, getAllRecords, clearRecords, deleteRecords, getRecord, upsertRecords } from './db.js';
import { seedDefaultRecordsIfEmpty, resetToMockRecords, MOCK_RECORDS } from './mock-data.js';
import { CrateController } from './crate.js';
import { BrowseView, normalizeView, railLabel } from './browse.js';
import { GatefoldController } from './notes.js';
import { syncDiscogsCollection, enrichTracklistsInBackground, enrichGenresInBackground, groupTracksBySide, calculateTotalDuration, parseSortArtist, getGenreTags, getRecordTags, tagLabel, enrichDetailsInBackground, enrichYearsInBackground, enrichArtInBackground, enrichDeezerArtInBackground, verifyArtInBackground, recheckArtInBackground, needsArtRecheck, enrichMasterTitleArtInBackground, needsMasterTitleArt, needsDeezerArt, needsItunesArt, needsArtVerification, loadRecordDetails, needsDetails, refreshCollectionFields } from './sync.js';
import { sortYear } from './years.js';
import { computeStats } from './stats.js';
import { computeHealth, describeStorage, healthSummary } from './health.js';
import { watchForUpdates, shouldAutoReload } from './updates.js';
import { needsAutoSync, timeAgo, readSyncMeta } from './syncplan.js';
import { sourceSnapshot } from './sourcestats.js';
import { statsHTML, valueHTML } from './statsview.js';
import { initDiscogs, discogsFetch, discogsState, isDiscogsConnected, onDiscogsChange, onDiscogsQueue, disconnectDiscogs, saveToken, forgetToken } from './discogs.js';

const DEFAULT_TITLE = 'Spindex | Your record collection';

const slugify = (text) => String(text || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/['’]/g, '')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'untitled';

const MAX_GENRE_TABS = 6;

// The ambient glow: the cover is squeezed onto a small canvas and blurred there once (by averaging shifted copies of it),
// then stretched across the screen. Nothing is filtered while the stack moves. No pixels are read, so covers from other
// sites (which can't be read) work too.
const GLOW_OFFSETS = [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, 2], [2, -2], [-2, -2]];
function paintGlow(canvas, img) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  try {
    const size = canvas.width;
    const scratch = document.createElement('canvas');
    scratch.width = scratch.height = size;
    const sctx = scratch.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = 1;
    ctx.drawImage(img, 0, 0, size, size);
    for (let pass = 0; pass < 4; pass++) {
      sctx.globalAlpha = 1;
      sctx.clearRect(0, 0, size, size);
      sctx.drawImage(canvas, 0, 0);
      GLOW_OFFSETS.forEach(([dx, dy], i) => {
        ctx.globalAlpha = 1 / (i + 1);
        ctx.drawImage(scratch, dx, dy);
      });
    }
    ctx.globalAlpha = 1;
    return true;
  } catch {
    return false;
  }
}

// Service worker registration: bypass on localhost to prevent stale asset caching during dev
const isLocalhost = Boolean(
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname.endsWith('.localhost')
);

if ('serviceWorker' in navigator) {
  if (isLocalhost) {
    // Unregister any active service workers and clear caches in local development
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((reg) => reg.unregister());
    });
    if ('caches' in window) {
      caches.keys().then((names) => {
        names.forEach((name) => caches.delete(name));
      });
    }
  } else if (window.location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('ServiceWorker registration error:', err);
      });
    });
    window.spindexUpdates = watchForUpdates({
      container: navigator.serviceWorker,
      onReady: () => { const pill = document.getElementById('update-pill'); if (pill) pill.hidden = false; },
    });
  }
}

class App {
  constructor() {
    this.crate = null;
    this.gatefold = null;
    this.currentSort = 'artist-last-year';
    this.activeVibe = 'all';
    this.allRecords = [];
    this.filteredRecords = [];
    this.metaFadeTimeout = null;
    this.lastMetaRecordId = null;

    this.initDOM();
    this.initControllers();
    this.initEvents();
    this.bootstrap();
  }

  initDOM() {
    this.stackContainer = document.getElementById('crate-stack');
    this.counterEl = document.getElementById('crate-counter');
    this.sortSelect = document.getElementById('sort-select');
    this.searchForm = document.getElementById('crate-search');
    this.searchInput = document.getElementById('search-input');
    this.searchToggleBtn = document.getElementById('search-toggle-btn');
    this.searchQuery = '';
    this.prevBtn = document.getElementById('prev-btn');
    this.nextBtn = document.getElementById('next-btn');

    this.vibeBar = document.querySelector('.vibe-filter-bar');
    this.browseToggleBtn = document.getElementById('browse-toggle-btn');
    this.browseToggleLabel = document.getElementById('browse-toggle-label');
    this.browseBackdrop = document.getElementById('browse-backdrop');



    this.browseRoot = document.getElementById('browse-view');
    this.viewButtons = [...document.querySelectorAll('.view-btn')];
    this.view = 'stack';
    try { this.view = normalizeView(localStorage.getItem('spindex_view')); } catch { /* storage can be unavailable */ }

    this.glowLayers = [
      document.getElementById('ambient-glow-img'),
      document.getElementById('ambient-glow-img-b'),
    ].filter(Boolean);
    this.glowActive = -1;
    this.glowUrl = '';

    // Active metadata column elements
    this.stationMetadataCol = document.getElementById('station-metadata-col');
    this.metaTitle = document.getElementById('meta-title');
    this.metaLine = document.getElementById('meta-line');
    this.metaArtist = document.getElementById('meta-artist');
    this.metaYear = document.getElementById('meta-year');
    this.metaDuration = document.getElementById('meta-duration');
    this.metaGenres = document.getElementById('meta-genres');
    this.metaTrackSummary = document.getElementById('meta-track-summary');
    this.metaInspectBtn = document.getElementById('meta-inspect-btn');

    this.settingsDrawer = document.getElementById('settings-drawer');
    this.settingsToggleBtn = document.getElementById('settings-toggle-btn');
    this.settingsCloseBtn = document.getElementById('settings-close-btn');

    this.usernameInput = document.getElementById('discogs-username');
    this.tokenInput = document.getElementById('discogs-token');
    this.syncBtn = document.getElementById('sync-discogs-btn');
    this.syncTokenBtn = document.getElementById('sync-token-btn');
    this.discogsConnectedEl = document.getElementById('discogs-connected');
    this.discogsConnectedText = document.getElementById('discogs-connected-text');
    this.discogsConnectEl = document.getElementById('discogs-connect');
    this.discogsUnconfiguredEl = document.getElementById('discogs-unconfigured');
    this.discogsDisconnectBtn = document.getElementById('discogs-disconnect-btn');
    this.discogsTokenDetails = document.getElementById('discogs-token-details');
    this.syncStatus = document.getElementById('sync-status');
    this.clearCacheBtn = document.getElementById('clear-cache-btn');

    // Restore saved settings
    if (this.usernameInput) {
      this.usernameInput.value = localStorage.getItem('discogs_username') || '';
    }
    if (this.tokenInput) {
      this.tokenInput.value = localStorage.getItem('discogs_token') || '';
    }

  }

  initControllers() {
    this.crate = new CrateController(
      this.stackContainer,
      this.counterEl,
      (record) => this.openRecordDetail(record),
      (currIndex, total, currentRecord) => this.onCrateIndexChange(currIndex, total, currentRecord)
    );

    this.browse = new BrowseView({
      root: this.browseRoot,
      rail: document.getElementById('browse-rail'),
      describe: (record) => {
        const year = sortYear(record);
        const tags = getRecordTags(record);
        return {
          year: year ? String(year) : '',
          genre: tags[0] ? tagLabel(tags[0]) : '',
          length: calculateTotalDuration(record.tracklist) || '',
        };
      },
      onOpen: (index) => {
        this.crate.setIndex(index);
        this.openRecordDetail(this.filteredRecords[index]);
      },
      onJump: (index) => {
        if (this.view !== 'stack') return false;
        this.crate.setIndex(index);
        this.armJumpClose();
        return true;
      },
      onSort: (sort) => {
        if (this.sortSelect) this.sortSelect.value = sort;
        this.currentSort = sort;
        this.applyFiltersAndSort();
      },
    });

    this.gatefold = new GatefoldController({
      onStep: (direction) => this.stepInspector(direction),
      onJump: (id) => this.jumpToRecord(id),
      getPosition: () => ({ index: this.crate.currentIndex, total: this.filteredRecords.length }),
      onRoute: (record, mode) => this.syncUrl(record, mode),
      onArtworkChange: () => this.refreshInPlace(),
      onArtworkRetry: () => this.fillMissingArt(),
    });
  }

  initEvents() {
    // Navigation buttons
    if (this.prevBtn) {
      this.prevBtn.addEventListener('click', () => this.crate.prev());
    }
    if (this.nextBtn) {
      this.nextBtn.addEventListener('click', () => this.crate.next());
    }

    // Sort select
    if (this.sortSelect) {
      this.sortSelect.addEventListener('change', (e) => {
        this.currentSort = e.target.value;
        this.applyFiltersAndSort();
      });
    }

    this.viewButtons.forEach((btn) => {
      if (btn.dataset.view) btn.addEventListener('click', () => this.setView(btn.dataset.view));
    });
    // Phones: search and the letter jump live in the bottom bar, in reach of a thumb
    document.getElementById('mobile-search-btn')?.addEventListener('click', () => this.searchToggleBtn?.click());
    this.counterEl?.addEventListener('click', () => { if (window.matchMedia('(max-width: 640px)').matches) this.openJump(); });
    document.addEventListener('pointerdown', (e) => {
      if (document.body.classList.contains('jump-open') && !e.target.closest('#browse-rail, #crate-counter')) this.closeJump();
    });
    document.getElementById('settings-stats-btn')?.addEventListener('click', () => {
      this.settingsDrawer?.classList.remove('open');
      this.settingsDrawer?.setAttribute('aria-hidden', 'true');
      this.openStats();
    });
    this.setView(this.view, { initial: true });

    this.initSearch();
    this.initFillStatus();
    this.requestPersistentStorage();

    // Genre tabs are rendered from the collection, so listen on the bar
    if (this.vibeBar) {
      this.vibeBar.addEventListener('click', (e) => {
        const pill = e.target.closest('.vibe-pill');
        if (!pill) return;
        this.activeVibe = pill.dataset.vibe || 'all';
        this.syncVibeTabs();
        this.applyFiltersAndSort();
        this.setBrowseOpen(false);
      });
    }

    // Browse sheet (compact screens): genres + sort
    if (this.browseToggleBtn) {
      this.browseToggleBtn.addEventListener('click', () => {
        this.setBrowseOpen(!document.body.classList.contains('browse-open'));
      });
    }
    if (this.browseBackdrop) {
      this.browseBackdrop.addEventListener('click', () => this.setBrowseOpen(false));
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.setBrowseOpen(false);
    });

    // Inspect button opens inline gatefold
    if (this.metaInspectBtn) {
      this.metaInspectBtn.addEventListener('click', () => {
        const currentRecord = this.filteredRecords[this.crate.currentIndex];
        if (currentRecord) {
          this.openRecordDetail(currentRecord);
        }
      });
    }

    // Collection stats
    this.statsDrawer = document.getElementById('stats-drawer');
    document.getElementById('stats-toggle-btn')?.addEventListener('click', () => this.openStats());
    document.getElementById('stats-close-btn')?.addEventListener('click', () => this.closeStats());
    this.statsDrawer?.addEventListener('click', (e) => { if (e.target === this.statsDrawer) this.closeStats(); });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.statsDrawer?.classList.contains('open')) this.closeStats();
    });

    // Settings drawer toggling
    if (this.settingsToggleBtn) {
      this.settingsToggleBtn.addEventListener('click', () => {
        this.openSettings();
      });
    }

    if (this.settingsCloseBtn) {
      this.settingsCloseBtn.addEventListener('click', () => {
        this.closeSettings();
      });
    }

    if (this.settingsDrawer) {
      this.settingsDrawer.addEventListener('click', (e) => {
        if (e.target === this.settingsDrawer) {
          this.closeSettings();
        }
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.settingsDrawer?.classList.contains('open')) {
        this.closeSettings();
      }
    });

    // Sync button
    if (this.syncTokenBtn) {
      this.syncTokenBtn.addEventListener('click', () => this.handleSync());
    }
    if (this.discogsDisconnectBtn) {
      this.discogsDisconnectBtn.addEventListener('click', async () => {
        if (discogsState().mode === 'token') await forgetToken();
        else await disconnectDiscogs();
        if (this.tokenInput) this.tokenInput.value = '';
        this.setSyncStatus('Disconnected from Discogs. Your crate stays on this device.', '');
      });
    }
    onDiscogsChange(() => { this.renderDiscogsSettings(); this.renderDemoNote(); });
    this.syncFullBtn = document.getElementById('sync-full-btn');
    if (this.syncFullBtn) this.syncFullBtn.addEventListener('click', () => this.handleSync({ full: true }));
    if (this.syncBtn) {
      this.syncBtn.addEventListener('click', () => this.handleSync());
    }

    // Clear what this browser has saved. The collection itself lives on Discogs and comes back on the next check.
    if (this.clearCacheBtn) {
      this.clearCacheBtn.addEventListener('click', async () => {
        if (!confirm('Clear local data? Your Discogs collection is untouched and comes back on the next check. Covers you chose are lost.')) return;
        await clearRecords();
        localStorage.removeItem('crate_owner');
        if (isDiscogsConnected()) {
          await this.loadAllRecords();
          this.closeSettings();
          this.autoSyncIfDue({ force: true });
        } else {
          await seedDefaultRecordsIfEmpty();
          await this.loadAllRecords();
          this.closeSettings();
        }
      });
    }
    document.getElementById('demo-note')?.addEventListener('click', () => this.openSettings());

    // Coming back to the app after a while: look for new records
    document.getElementById('update-pill')?.addEventListener('click', () => location.reload());
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      const updates = window.spindexUpdates;
      // Away for a while with a new version waiting: come back into it
      if (updates && shouldAutoReload({ ready: updates.isReady(), hiddenMs: hiddenAt ? Date.now() - hiddenAt : 0 })) {
        location.reload();
        return;
      }
      updates?.check();
      this.autoSyncIfDue();
    });
  }

  // Show the right Discogs controls for how this browser is connected
  renderDiscogsSettings() {
    const { mode, username, configured } = discogsState();
    const connected = mode !== 'none';

    if (this.discogsConnectedEl) this.discogsConnectedEl.hidden = !connected;
    if (this.discogsConnectEl) this.discogsConnectEl.hidden = connected || !configured;
    if (this.discogsUnconfiguredEl) this.discogsUnconfiguredEl.hidden = connected || configured;
    if (this.discogsDisconnectBtn) this.discogsDisconnectBtn.textContent = mode === 'token' ? 'Forget token' : 'Disconnect';
    if (this.discogsTokenDetails) {
      // The token form is the main way in when sign-in isn't available; otherwise it stays tucked away
      this.discogsTokenDetails.hidden = connected;
      if (!connected && !configured) this.discogsTokenDetails.open = true;
    }

    if (this.discogsConnectedText && connected) {
      const who = `<strong>${this.escapeHTML(username)}</strong>`;
      this.discogsConnectedText.innerHTML =  /*html*/ mode === 'oauth'
        ? `Connected to Discogs as ${who}.`
        : `Using a personal access token for ${who}.`;
    }
    if (this.usernameInput && mode === 'token') this.usernameInput.value = username;
  }

  openStats() {
    const content = document.getElementById('stats-content');
    if (!content || !this.statsDrawer) return;
    content.innerHTML =  /*html*/ statsHTML(computeStats(this.allRecords));
    this.statsDrawer.classList.add('open');
    this.statsDrawer.setAttribute('aria-hidden', 'false');
    this.showCollectionValue();
  }

  closeStats() {
    this.statsDrawer?.classList.remove('open');
    this.statsDrawer?.setAttribute('aria-hidden', 'true');
  }

  // What Discogs says the collection is worth right now. Shown, never saved: prices go stale within hours.
  async showCollectionValue() {
    const slot = document.getElementById('stat-value');
    if (!slot || !isDiscogsConnected() || !this.crateBelongsToCurrentUser()) return;
    slot.innerHTML =  /*html*/ valueHTML('loading');
    try {
      const res = await discogsFetch(`/users/${encodeURIComponent(discogsState().username)}/collection/value`);
      slot.innerHTML =  /*html*/ valueHTML(res.ok ? await res.json() : 'error');
    } catch {
      slot.innerHTML =  /*html*/ valueHTML('error');
    }
  }

  openSettings() {
    this.renderDiscogsSettings();
    this.renderFreshness();
    this.renderHealth();
    this.settingsDrawer?.classList.add('open');
    this.settingsDrawer?.setAttribute('aria-hidden', 'false');
  }

  // Coming back from Discogs' sign-in page (?discogs=connected|denied|error)
  async handleDiscogsReturn() {
    const params = new URLSearchParams(location.search);
    const outcome = params.get('discogs');
    if (!outcome) return;

    params.delete('discogs');
    const query = params.toString();
    history.replaceState(history.state, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);

    this.openSettings();
    if (outcome === 'connected') {
      const { username } = discogsState();
      const hasRealRecords = (await getAllRecords()).some((r) => !String(r.id).startsWith('discogs_mock_'));
      if (hasRealRecords) {
        this.setSyncStatus(`Connected to Discogs as ${username}.`, 'success');
      } else {
        this.handleSync(); // first connection: bring the collection in straight away
      }
    } else if (outcome === 'denied') {
      this.setSyncStatus('Discogs sign-in was cancelled.', 'error');
    } else {
      this.setSyncStatus("Couldn't complete the Discogs sign-in. Please try again.", 'error');
    }
  }

  // One crate per browser: if a different Discogs account connects, don't blend two collections together
  async claimCrateFor(username) {
    const owner = localStorage.getItem('crate_owner');
    if (owner && owner.toLowerCase() !== username.toLowerCase()) {
      const realRecords = (await getAllRecords()).filter((r) => !String(r.id).startsWith('discogs_mock_'));
      if (realRecords.length > 0 && !confirm(`This crate holds ${owner}'s collection. Replace it with ${username}'s?`)) {
        return false;
      }
      await clearRecords();
    }
    localStorage.setItem('crate_owner', username);
    return true;
  }

  // Background jobs may only touch the crate that belongs to the connected account
  crateBelongsToCurrentUser() {
    const { username } = discogsState();
    const owner = localStorage.getItem('crate_owner');
    if (!owner) {
      localStorage.setItem('crate_owner', username); // crates synced before this existed belong to whoever is connected
      return true;
    }
    return owner.toLowerCase() === username.toLowerCase();
  }

  closeSettings() {
    if (this.settingsDrawer) {
      this.settingsDrawer.classList.remove('remove');
      this.settingsDrawer.classList.remove('open');
      this.settingsDrawer.setAttribute('aria-hidden', 'true');
    }
  }

  async bootstrap() {
    await openDB();
    await initDiscogs();
    // A first-time visitor sees a demo crate; someone connected to Discogs never does (their crate is brought in instead).
    // "?demo" reloads the demo on purpose, for testing.
    if (!isDiscogsConnected()) {
      if (new URLSearchParams(location.search).has('demo')) {
        await clearRecords();
        await resetToMockRecords();
      } else {
        await seedDefaultRecordsIfEmpty();
      }
    }
    this.renderDiscogsSettings();

    // Check if mock records need verified artwork or sortArtist update
    const sample = await getRecord('discogs_mock_001');
    if (sample && (sample.artwork?.thumbnail?.includes('wikimedia') || sample.sortArtist === 'Miles Davis')) {
      await upsertRecords(MOCK_RECORDS);
    }

    // Ensure all records in IndexedDB use the latest sortArtist parsing rules
    const allStored = await getAllRecords();
    const staleRecords = [];
    for (const record of allStored) {
      if (record.artist) {
        const expectedSort = parseSortArtist(record.artist);
        if (record.sortArtist !== expectedSort) {
          record.sortArtist = expectedSort;
          staleRecords.push(record);
        }
      }
    }
    if (staleRecords.length > 0) {
      await upsertRecords(staleRecords);
    }

    await this.loadAllRecords();
    this.openFromLocation(true);
    window.addEventListener('popstate', () => this.openFromLocation());
    this.handleDiscogsReturn();
    this.autoSyncIfDue();
    this.fillMissingArt().then(() => this.fillMissingGenres());
    this.refreshCollectionFieldsIfNeeded()
      .then(() => this.fillMissingYears())
      .then(() => this.fillMissingDetails())
      .then(() => this.fillMissingTracklists());
  }

  async loadAllRecords() {
    this.allRecords = await getAllRecords();
    this.renderDemoNote();
    this.buildRoutes();
    this.renderVibeTabs();
    this.applyFiltersAndSort();
  }

  // Browse tabs come from the collection: the most common genre tags, most-filled first
  renderVibeTabs() {
    if (!this.vibeBar) return;

    const counts = new Map();
    for (const record of this.allRecords) {
      for (const tag of getGenreTags(record)) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }

    const top = [...counts.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_GENRE_TABS)
      .map(([tag]) => tag);

    if (this.activeVibe !== 'all' && !counts.has(this.activeVibe)) this.activeVibe = 'all';
    // Keep the active tag visible even if it fell out of the top list
    if (this.activeVibe !== 'all' && !top.includes(this.activeVibe)) top.push(this.activeVibe);

    const tabs = top
      .map((tag) => `<button class="vibe-pill" data-vibe="${this.escapeHTML(tag)}">${this.escapeHTML(tagLabel(tag))}</button>`)
      .join('');
    this.vibeBar.innerHTML =  /*html*/ `<button class="vibe-pill" data-vibe="all">All</button>${tabs}`;
    this.syncVibeTabs();
  }

  syncVibeTabs() {
    let label = 'All';
    this.vibeBar?.querySelectorAll('.vibe-pill').forEach((pill) => {
      const active = pill.dataset.vibe === this.activeVibe;
      pill.classList.toggle('active', active);
      if (active) label = pill.textContent;
    });
    if (this.browseToggleLabel) this.browseToggleLabel.textContent = label;
  }

  // Condition grades and notes come from Discogs collection fields; fetch them once for records that predate them
  async refreshCollectionFieldsIfNeeded() {
    if (!isDiscogsConnected() || !this.crateBelongsToCurrentUser()) return;
    const { username } = discogsState();

    const stale = this.allRecords.some((r) => r.discogsId && !String(r.id).startsWith('discogs_mock_') && r.mediaCondition === undefined);
    if (!stale) return;

    try {
      await refreshCollectionFields(username);
      await this.loadAllRecords();
    } catch {
      // Try again next load
    }
  }

  // Full Discogs release (label, credits, pressing, videos) for the album inspector, fetched once per record
  async fillMissingDetails() {
    if (!isDiscogsConnected()) return;

    const missing = this.allRecords.filter(needsDetails);
    if (missing.length === 0) return;

    this.fill = { total: missing.length, done: 0 };
    try {
      await enrichDetailsInBackground(missing, () => {
        this.fill.done++;
        this.renderFillStatus();
      });
    } finally {
      this.fill = null;
    }
    await this.refreshInPlace();
  }

  // Where a record files in the crate depends on its original release year, which only its Discogs master knows
  async fillMissingYears() {
    if (!isDiscogsConnected()) return;

    const needsYear = this.allRecords.filter((r) => r.masterId && r.masterYear == null && !r.masterChecked && !String(r.id).startsWith('discogs_mock_'));
    if (needsYear.length === 0) return;

    this.fill = { label: 'Finding original release years…', total: needsYear.length, done: 0 };
    try {
      await enrichYearsInBackground(needsYear, (count) => {
        this.fill.done += count;
        this.renderFillStatus();
      });
    } finally {
      this.fill = null;
    }
    await this.refreshInPlace();
  }

  // Without this a browser may clear stored data when space runs short. It is only a request, and browsers may decline.
  requestPersistentStorage() {
    navigator.storage?.persist?.().catch(() => { });
  }

  // "Data health": what the crate knows, what is still filling in, and how each source has behaved this session
  async renderHealth() {
    const el = document.getElementById('health-content');
    if (!el) return;
    const h = computeHealth(this.allRecords);
    const summary = document.getElementById('health-summary');
    if (summary) summary.textContent = healthSummary(h);
    let estimate = {};
    let persisted;
    try {
      estimate = (await navigator.storage?.estimate?.()) || {};
      persisted = await navigator.storage?.persisted?.();
    } catch {
      // not available here
    }
    const storage = describeStorage({ usage: estimate.usage, quota: estimate.quota, persisted });
    let imageCount = 0;
    try {
      imageCount = (await (await caches.open('spindex-images-v1')).keys()).length;
    } catch {
      // no cache access here
    }
    const esc = (t) => this.escapeHTML ? this.escapeHTML(String(t)) : String(t);
    const row = (k, v) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`;
    const sources = sourceSnapshot();
    el.innerHTML =  /*html*/ `
      <dl class="health-rows">
        ${row('Records', h.total)}
        ${row('Cleaner covers', `${h.covers.cleaner} of ${h.total}`)}
        ${row('Discogs images', `${h.covers.discogs}${h.covers.offered ? ` (${h.covers.offered} with another cover on offer)` : ''}`)}
        ${row('Covers you chose', h.covers.pinned)}
        ${row('Release details', `${h.details.have} of ${h.details.total}${h.details.custom ? ` (${h.details.custom} custom)` : ''}`)}
        ${row('Original years', `${h.years.resolved} of ${h.years.total}`)}
        ${row('Back covers', h.backCovers.opened ? `${h.backCovers.found} found, ${h.backCovers.none} none, in ${h.backCovers.opened} albums opened` : 'Found as you open albums')}
        ${row('Still to work out', h.pending.art + h.pending.details === 0 ? 'Nothing' : `${h.pending.art} cover searches, ${h.pending.details} details`)}
        ${row('Storage used', `${storage.used} of ${storage.quota}`)}
        ${row('Protection', storage.persisted)}
        ${row('Pictures kept offline', imageCount)}
      </dl>
      <p class="stat-note">Sources this session</p>
      ${sources.length
    ? `<dl class="health-rows">${sources.map((s) => row(s.name, `${s.ok} ok${s.failed ? `, ${s.failed} failed (${s.last})` : ''}`)).join('')}</dl>`
    : '<p class="stat-note">Nothing asked yet.</p>'}`;
  }

  // A small pill that says what the background Discogs work is doing, so a slow first load reads as intentional
  initFillStatus() {
    this.fillStatusEl = document.getElementById('fill-status');
    this.reorderPill = document.getElementById('reorder-pill');
    this.reorderPill?.addEventListener('click', () => this.loadAllRecords());
    this.queueStats = { low: 0, pausedUntil: 0 };
    onDiscogsQueue((stats) => {
      this.queueStats = stats;
      this.renderFillStatus();
    });
  }

  renderFillStatus() {
    const el = this.fillStatusEl;
    if (!el) return;
    const { low, pausedUntil } = this.queueStats;
    const active = low > 0 || pausedUntil > 0;
    el.hidden = !active;
    if (!active) return;
    el.textContent = pausedUntil > 0
      ? 'Discogs asked us to slow down. Resuming shortly…'
      : this.fill?.total
        ? `${this.fill.label || 'Filling in details…'} ${this.fill.done} of ${this.fill.total}`
        : 'Finishing track lists…';
  }

  // Records still showing a Discogs photo of the sleeve get clean cover art: Deezer first (fast), then iTunes for the rest
  async fillMissingArt() {
    if (!this.allRecords.some((r) => needsDeezerArt(r) || needsItunesArt(r) || needsArtVerification(r) || needsArtRecheck(r) || needsMasterTitleArt(r))) return;

    const onEach = () => this.scheduleRefresh();
    await recheckArtInBackground(this.allRecords.filter(needsArtRecheck), onEach);
    this.allRecords = await getAllRecords();
    await verifyArtInBackground(this.allRecords.filter(needsArtVerification), onEach);
    this.allRecords = await getAllRecords();
    await enrichDeezerArtInBackground(this.allRecords.filter(needsDeezerArt), onEach);
    this.allRecords = await getAllRecords();
    await enrichArtInBackground(this.allRecords.filter(needsItunesArt), onEach);
    this.allRecords = await getAllRecords();
    await enrichMasterTitleArtInBackground(this.allRecords.filter(needsMasterTitleArt), onEach);
    await this.refreshInPlace();
  }

  // New artwork shows up in the stack as it arrives, in batches rather than one repaint per record
  scheduleRefresh() {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshInPlace();
    }, 4000);
  }

  fillMissingGenres() {
    const needsGenre = this.allRecords.filter((r) => !r.genreChecked || r.itunesUrl === undefined);
    if (needsGenre.length === 0) return;

    enrichGenresInBackground(needsGenre).then(() => this.refreshInPlace());
  }

  fillMissingTracklists() {
    if (!isDiscogsConnected()) return;

    const needsEnrichment = this.allRecords.filter((r) => {
      if (!r.discogsId) return false;
      if (!r.tracklist || r.tracklist.length === 0) return true;
      return r.tracklist.some((t) => !t.duration);
    });
    if (needsEnrichment.length === 0) return;

    enrichTracklistsInBackground(needsEnrichment).then(() => this.refreshInPlace());
  }

  setBrowseOpen(open) {
    document.body.classList.toggle('browse-open', open);
    if (this.browseToggleBtn) this.browseToggleBtn.setAttribute('aria-expanded', String(open));
  }

  // Search: filters the crate by album title or artist. "/" focuses it, Escape clears it.
  initSearch() {
    if (!this.searchInput) return;
    const setOpen = (open) => {
      document.body.classList.toggle('search-open', open);
      if (open) this.searchInput.focus();
    };
    const clear = () => {
      this.searchInput.value = '';
      this.searchQuery = '';
      this.applyFiltersAndSort();
    };

    this.searchToggleBtn.addEventListener('click', () => {
      if (document.body.classList.contains('search-open') && !this.searchQuery) setOpen(false);
      else setOpen(true);
    });

    this.searchInput.addEventListener('input', () => {
      this.searchQuery = this.searchInput.value;
      this.applyFiltersAndSort();
    });

    // Enter hands the keyboard back to the crate, so the arrow keys move through the matches
    this.searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.searchInput.blur();
    });

    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (this.searchInput.value) clear();
      else { this.searchInput.blur(); setOpen(false); }
    });

    this.searchInput.addEventListener('blur', () => {
      if (!this.searchQuery) document.body.classList.remove('search-open');
    });

    window.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (document.querySelector('.gatefold-workspace.open') || document.querySelector('.settings-drawer.open')) return;
      e.preventDefault();
      this.setBrowseOpen(false);
      setOpen(true);
      this.searchInput.select();
    });
  }

  matchesSearch(record) {
    const fold = (text) => String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const haystack = fold(`${record.title} ${record.artist}`);
    return fold(this.searchQuery).split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
  }

  // The crate's contents in the current filter and sort, without touching the screen
  computeList() {
    let list = [...this.allRecords];

    // Filter by tag: a record shows under every genre tag it carries
    if (this.activeVibe !== 'all') {
      const target = this.activeVibe.toLowerCase();
      list = list.filter((r) => getGenreTags(r).some((t) => t.toLowerCase() === target));
    }

    if (this.searchQuery.trim()) list = list.filter((r) => this.matchesSearch(r));

    const getSortYear = sortYear;

    // Sort list
    if (this.currentSort === 'artist-last-year' || this.currentSort === 'artist') {
      list.sort((a, b) => {
        const artistA = parseSortArtist(a.artist) || a.sortArtist || a.artist || '';
        const artistB = parseSortArtist(b.artist) || b.sortArtist || b.artist || '';
        const artistComp = artistA.localeCompare(artistB);
        if (artistComp !== 0) return artistComp;

        const yearComp = getSortYear(a) - getSortYear(b);
        if (yearComp !== 0) return yearComp;

        return (a.title || '').localeCompare(b.title || '');
      });
    } else if (this.currentSort === 'artist-first') {
      list.sort((a, b) => {
        const artistA = a.artist || '';
        const artistB = b.artist || '';
        const artistComp = artistA.localeCompare(artistB);
        if (artistComp !== 0) return artistComp;

        const yearComp = getSortYear(a) - getSortYear(b);
        if (yearComp !== 0) return yearComp;

        return (a.title || '').localeCompare(b.title || '');
      });
    } else if (this.currentSort === 'year') {
      list.sort((a, b) => {
        const yearComp = getSortYear(a) - getSortYear(b);
        if (yearComp !== 0) return yearComp;
        const artistA = parseSortArtist(a.artist) || a.sortArtist || a.artist || '';
        const artistB = parseSortArtist(b.artist) || b.sortArtist || b.artist || '';
        const artistComp = artistA.localeCompare(artistB);
        if (artistComp !== 0) return artistComp;
        return (a.title || '').localeCompare(b.title || '');
      });
    } else if (this.currentSort === 'added') {
      list.sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0));
    } else if (this.currentSort === 'genre') {
      list.sort((a, b) => {
        const gA = getGenreTags(a)[0] || 'Other';
        const gB = getGenreTags(b)[0] || 'Other';
        const comp = gA.localeCompare(gB);
        if (comp !== 0) return comp;
        const artistA = parseSortArtist(a.artist) || a.sortArtist || a.artist || '';
        const artistB = parseSortArtist(b.artist) || b.sortArtist || b.artist || '';
        return artistA.localeCompare(artistB);
      });
    }

    return list;
  }

  applyFiltersAndSort() {
    const list = this.computeList();
    const currentActiveId = this.filteredRecords[this.crate?.currentIndex]?.id || null;
    this.filteredRecords = list;
    this.crate.setRecords(list, this.currentSort, currentActiveId);
    const activeRecord = list[this.crate.currentIndex] || null;
    this.updateActiveMetadata(activeRecord);
    if (this.reorderPill) this.reorderPill.hidden = true;
    this.browseDirty = true;
    if (this.view !== 'stack') this.renderBrowse();
  }

  // Stack, grid or list. The choice is remembered; the record you were on stays in view across all three.
  setView(view, { initial = false } = {}) {
    this.view = normalizeView(view);
    try { localStorage.setItem('spindex_view', this.view); } catch { /* fine */ }
    document.body.dataset.view = this.view;
    this.closeJump();
    this.viewButtons.forEach((btn) => { if (btn.dataset.view) btn.setAttribute('aria-pressed', String(btn.dataset.view === this.view)); });
    if (this.browseRoot) this.browseRoot.hidden = this.view === 'stack';
    if (this.view === 'stack') {
      if (!initial) this.crate.refreshLayout();
      return;
    }
    if (!initial || this.filteredRecords.length) this.renderBrowse();
  }

  railKey(record) {
    return railLabel(this.currentSort, record);
  }

  // Stack view on a phone: tapping the counter brings up the letter (or decade) strip to jump along the crate
  openJump() {
    if (this.view !== 'stack') return;
    this.browse.buildRail(this.filteredRecords, (record) => this.railKey(record));
    if (this.browse.groups.length < 2) return;
    document.body.classList.add('jump-open');
    this.browse.markRail(this.browse.groupFor(this.crate.currentIndex));
    this.armJumpClose();
  }

  armJumpClose() {
    clearTimeout(this.jumpTimer);
    this.jumpTimer = setTimeout(() => this.closeJump(), 5000);
  }

  closeJump() {
    clearTimeout(this.jumpTimer);
    document.body.classList.remove('jump-open');
  }

  renderBrowse() {
    if (!this.browseRoot || this.view === 'stack') return;
    const modeChanged = this.browseRoot.dataset.mode !== this.view;
    if (this.browseDirty || modeChanged) {
      const scrollTop = this.browseRoot.scrollTop;
      this.browse.render(this.filteredRecords, this.view, this.currentSort, this.crate.currentIndex, (record) => this.railKey(record));
      this.browseRoot.scrollTop = modeChanged ? 0 : scrollTop;
      this.browseDirty = false;
      if (modeChanged) this.browse.scrollToActive();
    } else {
      this.browse.setActive(this.crate.currentIndex);
      this.browse.scrollToActive();
    }
  }

  // Background work (years, details, genres) saves new data all the time. It must never move records around under
  // someone's hands, so it refreshes the records in place, keeps the order, and offers a re-sort instead.
  async refreshInPlace() {
    this.allRecords = await getAllRecords();
    const byId = new Map(this.allRecords.map((r) => [r.id, r]));
    this.filteredRecords = this.filteredRecords.map((r) => byId.get(r.id) || r);
    this.crate.refreshRecords(this.filteredRecords);
    if (this.view !== 'stack') this.browse.refresh(this.filteredRecords);
    this.buildRoutes();
    this.updateActiveMetadata(this.filteredRecords[this.crate.currentIndex] || null);
    this.checkPendingOrder();
  }

  checkPendingOrder() {
    if (!this.reorderPill) return;
    const next = this.computeList();
    const same = next.length === this.filteredRecords.length && next.every((r, i) => r.id === this.filteredRecords[i].id);
    this.reorderPill.hidden = same;
  }

  onCrateIndexChange(currIndex, total, currentRecord) {
    if (this.browse) this.browse.setActive(currIndex);
    const nextId = currentRecord?.id || null;
    if (nextId === this.lastMetaRecordId) {
      this.updateActiveMetadata(currentRecord);
      return;
    }

    this.prefetchDetails(currentRecord);

    if (this.stationMetadataCol) {
      clearTimeout(this.metaFadeTimeout);
      this.stationMetadataCol.classList.add('is-updating');
      this.metaFadeTimeout = setTimeout(() => {
        this.updateActiveMetadata(currentRecord);
        this.stationMetadataCol.classList.remove('is-updating');
      }, 140);
    } else {
      this.updateActiveMetadata(currentRecord);
    }
  }

  // Resting on a record for a moment usually means its page is next, so fetch its Discogs details now. Opening it then
  // shows the complete page straight away instead of filling in after.
  prefetchDetails(record) {
    clearTimeout(this.prefetchTimer);
    if (!record?.discogsId || record.details || !isDiscogsConnected() || String(record.id).startsWith('discogs_mock_')) return;
    this.prefetchTimer = setTimeout(() => {
      loadRecordDetails(record, 'high').catch(() => { });
    }, 400);
  }

  // The glow is a wash of colour, so each cover is blurred once on a small canvas (see paintGlow). It also waits for the stack to stop moving, so nothing competes with the animation.
  setGlow(url) {
    if (this.glowLayers.length < 2 || url === this.glowUrl) return;
    this.glowUrl = url;
    clearTimeout(this.glowTimer);

    if (!url) {
      this.glowLayers.forEach((l) => { l.style.opacity = '0'; });
      return;
    }

    this.glowTimer = setTimeout(() => {
      const next = (this.glowActive + 1) % 2;
      const incoming = this.glowLayers[next];
      const outgoing = this.glowLayers[this.glowActive];
      const img = new Image();
      img.onload = () => {
        if (this.glowUrl !== url) return;
        if (!paintGlow(incoming, img)) return;
        incoming.style.opacity = '0.4';
        if (outgoing) outgoing.style.opacity = '0';
        this.glowActive = next;
      };
      img.src = url;
    }, 220);
  }

  updateActiveMetadata(record) {
    this.lastMetaRecordId = record?.id || null;

    // The glow is a heavily blurred wash of colour, so the small thumbnail is all it needs
    this.setGlow(record?.artwork?.thumbnail || record?.artwork?.highRes || '');

    if (!record) {
      if (this.metaTitle) this.metaTitle.textContent = 'No records in crate';
      if (this.metaLine) this.metaLine.textContent = '';
      if (this.metaArtist) this.metaArtist.textContent = '';
      if (this.metaYear) this.metaYear.textContent = '';
      if (this.metaDuration) this.metaDuration.textContent = '';
      if (this.metaGenres) this.metaGenres.innerHTML =  /*html*/ '';
      if (this.metaTrackSummary) this.metaTrackSummary.textContent = '';
      return;
    }

    if (this.metaTitle) this.metaTitle.textContent = record.title || 'Untitled';
    if (this.metaLine) {
      const firstTag = getRecordTags(record)[0];
      this.metaLine.textContent = [sortYear(record) || '', firstTag ? tagLabel(firstTag) : ''].filter(Boolean).join(' · ');
    }
    if (this.metaArtist) this.metaArtist.textContent = record.artist || 'Unknown Artist';
    const primaryYear = sortYear(record);
    if (this.metaYear) this.metaYear.textContent = primaryYear ? String(primaryYear) : '';

    if (this.metaDuration) {
      const dur = calculateTotalDuration(record.tracklist);
      this.metaDuration.textContent = dur || '';
      this.metaDuration.style.display = dur ? '' : 'none';
    }

    if (this.metaGenres) {
      const tags = getRecordTags(record).slice(0, 3).map((t) => tagLabel(t));
      this.metaGenres.innerHTML =  /*html*/ tags
        .map((t) => `<span class="meta-genre-tag">${this.escapeHTML(t)}</span>`)
        .join('');
    }

    if (this.metaTrackSummary) {
      this.metaTrackSummary.textContent = this.formatTrackSummary(record.tracklist || []);
    }
  }

  // One quiet line, e.g. "24 tracks · 4 sides"; the full tracklist lives in the sleeve view
  formatTrackSummary(tracks) {
    if (!tracks || tracks.length === 0) return '';

    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const parts = [plural(tracks.length, 'track')];

    const groups = groupTracksBySide(tracks);
    if (groups && groups.length > 0) {
      const discs = groups.every((g) => g.sideKey.startsWith('Disc '));
      parts.push(plural(groups.length, discs ? 'disc' : 'side'));
    }

    return parts.join(' · ');
  }

  escapeHTML(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ------------------------------------------------------------------------
  // Addresses: /album/<artist>/<title>/ opens that record's inspector, so a refresh lands back on it
  // ------------------------------------------------------------------------

  buildRoutes() {
    this.routeByPath = new Map();
    this.pathById = new Map();
    for (const record of [...this.allRecords].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
      const base = `/album/${slugify(record.artist)}/${slugify(record.title)}/`;
      let path = base;
      // Two pressings of the same title get a numeric suffix so every address is unique
      for (let n = 2; this.routeByPath.has(path); n++) path = `/album/${slugify(record.artist)}/${slugify(record.title)}-${n}/`;
      this.routeByPath.set(path, record);
      this.pathById.set(record.id, path);
    }
  }

  routePath(record) {
    return this.pathById?.get(record.id) || `/album/${slugify(record.artist)}/${slugify(record.title)}/`;
  }

  recordForPath(pathname) {
    const path = pathname.endsWith('/') ? pathname : `${pathname}/`;
    return this.routeByPath?.get(path) || null;
  }

  setPageTitle(record) {
    document.title = record ? `${record.title} — ${record.artist} · Spindex` : DEFAULT_TITLE;
  }

  // mode: 'push' (opened from the crate), 'replace' (moved to another record), 'close'
  syncUrl(record, mode) {
    this.setPageTitle(record);
    if (mode === 'close') {
      // Closing after opening from the crate steps back in history; a cold-loaded address just becomes "/"
      if (history.state?.album && !history.state.entry) history.back();
      else if (location.pathname !== '/') history.replaceState(null, '', '/');
      return;
    }
    const path = this.routePath(record);
    if (mode === 'push' && !history.state?.album) {
      history.pushState({ album: true }, '', path);
    } else if (location.pathname !== path) {
      history.replaceState({ album: true, entry: Boolean(history.state?.entry) }, '', path);
    }
  }

  // Show a record at the front of the crate, clearing any filter that would hide it
  showInCrate(record) {
    let index = this.filteredRecords.findIndex((r) => r.id === record.id);
    if (index === -1) {
      this.activeVibe = 'all';
      this.syncVibeTabs();
      this.applyFiltersAndSort();
      index = this.filteredRecords.findIndex((r) => r.id === record.id);
    }
    if (index !== -1) this.crate.setIndex(index);
  }

  // On load and on Back/Forward: open whatever record the address names, or close the inspector
  openFromLocation(initial = false) {
    const record = this.recordForPath(location.pathname);
    if (record) {
      this.showInCrate(record);
      if (initial) history.replaceState({ album: true, entry: true }, '', location.pathname);
      this.setPageTitle(record);
      this.gatefold.openGatefold(record, 'none');
    } else {
      this.gatefold.closeGatefold(true);
      this.setPageTitle(null);
    }
  }

  // Move the crate by one record while the inspector is open; returns the record now showing
  stepInspector(direction) {
    const target = this.crate.currentIndex + direction;
    if (target < 0 || target >= this.filteredRecords.length) return null;
    this.crate.setIndex(target);
    return this.filteredRecords[target];
  }

  // Bring any record in the collection to the front of the crate and open it
  jumpToRecord(id) {
    let index = this.filteredRecords.findIndex((r) => r.id === id);
    if (index === -1) {
      // Filtered out by the current tab: show everything so the record can be found
      this.activeVibe = 'all';
      this.syncVibeTabs();
      this.applyFiltersAndSort();
      index = this.filteredRecords.findIndex((r) => r.id === id);
    }
    if (index === -1) return;
    this.crate.setIndex(index);
    this.openRecordDetail(this.filteredRecords[index], 'replace');
  }

  openRecordDetail(record, mode = 'push') {
    if (this.gatefold) {
      this.gatefold.openGatefold(record, mode);
    }
  }

  async handleSync({ full = false, auto = false } = {}) {
    if (this.syncing) return;
    this.syncing = true;
    this.renderFreshness();
    try {
      await this.runSync({ full, auto });
    } finally {
      this.syncing = false;
      this.renderFreshness();
    }
  }

  // Opening the app (or coming back to it) checks for new records when it has been a while. Nobody needs to press anything.
  async autoSyncIfDue({ force = false } = {}) {
    if (this.syncing || !isDiscogsConnected()) return;
    const { username } = discogsState();
    const hasRealRecords = this.allRecords.some((r) => !String(r.id).startsWith('discogs_mock_'));
    if (hasRealRecords && !this.crateBelongsToCurrentUser()) return; // someone else's crate: that is for a person to decide
    if (!force && !needsAutoSync(readSyncMeta(username))) return;
    await this.handleSync({ auto: true });
  }

  renderFreshness() {
    const el = document.getElementById('sync-freshness');
    if (!el) return;
    el.classList.toggle('is-busy', Boolean(this.syncing));
    if (this.syncing) {
      el.textContent = 'Checking for new records…';
      return;
    }
    const { username } = discogsState();
    const last = username ? readSyncMeta(username).lastCheckedAt : 0;
    el.textContent = last ? `Up to date. Checked ${timeAgo(last)}.` : 'Not checked yet.';
  }

  // The demo crate is for a first visit: it goes away once Discogs is connected
  renderDemoNote() {
    const note = document.getElementById('demo-note');
    if (!note) return;
    const onlyDemo = this.allRecords.length > 0 && this.allRecords.every((r) => String(r.id).startsWith('discogs_mock_'));
    note.hidden = !(onlyDemo && !isDiscogsConnected());
  }

  async runSync({ full = false, auto = false }) {
    // Typed-in token: save it first (this is the fallback path; signed-in users skip straight to syncing)
    if (!auto && discogsState().mode !== 'oauth') {
      const username = this.usernameInput?.value.trim();
      const token = this.tokenInput?.value.trim();
      if (username && token) {
        await saveToken(username, token);
      } else if (!isDiscogsConnected()) {
        this.setSyncStatus('Connect Discogs, or provide a username and personal token.', 'error');
        return;
      }
    }

    const { username } = discogsState();
    const hadRealRecords = (await getAllRecords()).some((r) => !String(r.id).startsWith('discogs_mock_'));
    if (auto) {
      if (!hadRealRecords) localStorage.setItem('crate_owner', username);
    } else if (!(await this.claimCrateFor(username))) {
      this.setSyncStatus('Sync cancelled. Your crate is unchanged.', '');
      return;
    }

    const buttons = [this.syncBtn, this.syncFullBtn, this.syncTokenBtn].filter(Boolean);
    buttons.forEach((b) => { b.disabled = true; });
    this.setSyncStatus(hadRealRecords ? 'Checking for new records...' : 'Bringing in your collection...', '');

    try {
      const result = await syncDiscogsCollection(username, ({ page, totalPages, count, message, quick }) => {
        if (message) return this.setSyncStatus(message, '');
        if (quick) return this.setSyncStatus('Checking for new records...', '');
        this.setSyncStatus(`Syncing page ${page} of ${totalPages} (${count} albums)...`, '');
      }, { full });

      const stale = (await getAllRecords()).filter((r) => String(r.id).startsWith('discogs_mock_'));
      if (stale.length > 0) await deleteRecords(stale.map((r) => r.id));

      this.setSyncStatus(result.quick
        ? (result.added > 0 ? `Added ${result.added} new ${result.added === 1 ? 'record' : 'records'}.` : 'Already up to date.')
        : result.removed > 0 ? `Sync complete! Removed ${result.removed} ${result.removed === 1 ? 'record' : 'records'} no longer in your collection.` : 'Sync complete! Crate updated.', 'success');
      if (auto && hadRealRecords) {
        // Someone may be browsing: don't rebuild the stack under them. A small pill offers the update instead.
        this.allRecords = await getAllRecords();
        this.renderDemoNote();
        this.checkPendingOrder();
      } else {
        await this.loadAllRecords();
      }
      // One request per release supplies its details and tracklist; durations still missing are filled from the master after
      this.fillMissingArt();
      this.fillMissingYears().then(() => this.fillMissingDetails()).then(() => this.fillMissingTracklists());
    } catch (err) {
      console.error(err);
      this.setSyncStatus(err.message === 'Not connected to Discogs'
        ? 'Your Discogs connection has ended. Please connect again.'
        : `Sync failed: ${err.message}`, 'error');
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  setSyncStatus(msg, type = '') {
    if (!this.syncStatus) return;
    this.syncStatus.textContent = msg;
    this.syncStatus.className = `sync-status ${type}`.trim();
  }
}

// Start application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new App());
} else {
  new App();
}

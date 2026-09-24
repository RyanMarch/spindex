// app.js - Main application coordinator
import { openDB, getAllRecords, clearRecords, deleteRecords, countRecords, getRecord, upsertRecords } from './db.js';
import { seedDefaultRecordsIfEmpty, resetToMockRecords, MOCK_RECORDS } from './mock-data.js';
import { CrateController } from './crate.js';
import { GatefoldController } from './notes.js';
import { syncDiscogsCollection, enrichTracklistsInBackground, enrichGenresInBackground, groupTracksBySide, calculateTotalDuration, parseSortArtist, getGenreTags, getRecordTags, tagLabel, enrichDetailsInBackground, refreshCollectionFields } from './sync.js';
import { initDiscogs, discogsState, isDiscogsConnected, onDiscogsChange, disconnectDiscogs, saveToken, forgetToken } from './discogs.js';

const DEFAULT_TITLE = 'Crate | Vinyl Record Companion';

const slugify = (text) => String(text || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/['’]/g, '')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'untitled';

const MAX_GENRE_TABS = 6;

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



    this.glowLayers = [
      document.getElementById('ambient-glow-img'),
      document.getElementById('ambient-glow-img-b'),
    ].filter(Boolean);
    this.glowActive = -1;
    this.glowUrl = '';

    // Active metadata column elements
    this.stationMetadataCol = document.getElementById('station-metadata-col');
    this.metaTitle = document.getElementById('meta-title');
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
    this.resetDemoBtn = document.getElementById('reset-demo-btn');
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

    this.gatefold = new GatefoldController({
      onStep: (direction) => this.stepInspector(direction),
      onJump: (id) => this.jumpToRecord(id),
      getPosition: () => ({ index: this.crate.currentIndex, total: this.filteredRecords.length }),
      onRoute: (record, mode) => this.syncUrl(record, mode),
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

    this.initSearch();

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
    onDiscogsChange(() => this.renderDiscogsSettings());
    if (this.syncBtn) {
      this.syncBtn.addEventListener('click', () => this.handleSync());
    }

    // Demo reset button
    if (this.resetDemoBtn) {
      this.resetDemoBtn.addEventListener('click', async () => {
        this.resetDemoBtn.disabled = true;
        this.resetDemoBtn.textContent = 'Reloading...';
        await clearRecords();
        await resetToMockRecords();
        await this.loadAllRecords();
        this.resetDemoBtn.textContent = 'Demo Reloaded!';
        setTimeout(() => {
          this.resetDemoBtn.textContent = 'Reload Demo Crate';
          this.resetDemoBtn.disabled = false;
        }, 1500);
      });
    }

    // Clear cache button
    if (this.clearCacheBtn) {
      this.clearCacheBtn.addEventListener('click', async () => {
        if (confirm('Clear local database? You can reload the demo anytime.')) {
          await clearRecords();
          await this.loadAllRecords();
          this.closeSettings();
        }
      });
    }
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
        ? `Connected to Discogs as ${who}. Sync brings in your latest collection.`
        : `Using a personal access token for ${who}. Sync brings in your latest collection.`;
    }
    if (this.usernameInput && mode === 'token') this.usernameInput.value = username;
  }

  openSettings() {
    this.renderDiscogsSettings();
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
    await seedDefaultRecordsIfEmpty();
    await initDiscogs();
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
    this.fillMissingGenres();
    this.refreshCollectionFieldsIfNeeded()
      .then(() => this.fillMissingDetails())
      .then(() => this.fillMissingTracklists());
  }

  async loadAllRecords() {
    this.allRecords = await getAllRecords();
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
    this.vibeBar.innerHTML =  /*html*/ `<button class="vibe-pill" data-vibe="all">All Records</button>${tabs}`;
    this.syncVibeTabs();
  }

  syncVibeTabs() {
    let label = 'All Records';
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

    const needsDetails = this.allRecords.filter((r) => r.discogsId && !r.details && !String(r.id).startsWith('discogs_mock_'));
    if (needsDetails.length === 0) return;

    await enrichDetailsInBackground(needsDetails);
    await this.loadAllRecords();
  }

  fillMissingGenres() {
    const needsGenre = this.allRecords.filter((r) => !r.genreChecked || r.itunesUrl === undefined);
    if (needsGenre.length === 0) return;

    enrichGenresInBackground(needsGenre).then(() => this.loadAllRecords());
  }

  fillMissingTracklists() {
    if (!isDiscogsConnected()) return;

    const needsEnrichment = this.allRecords.filter((r) => {
      if (!r.discogsId) return false;
      if (!r.tracklist || r.tracklist.length === 0) return true;
      return r.tracklist.some((t) => !t.duration);
    });
    if (needsEnrichment.length === 0) return;

    enrichTracklistsInBackground(needsEnrichment).then(() => this.loadAllRecords());
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

  applyFiltersAndSort() {
    let list = [...this.allRecords];

    // Filter by tag: a record shows under every genre tag it carries
    if (this.activeVibe !== 'all') {
      const target = this.activeVibe.toLowerCase();
      list = list.filter((r) => getGenreTags(r).some((t) => t.toLowerCase() === target));
    }

    if (this.searchQuery.trim()) list = list.filter((r) => this.matchesSearch(r));

    const getSortYear = (r) => {
      if (r.year && r.masterYear && r.year !== r.masterYear) {
        return r.year;
      }
      return r.masterYear || r.originalYear || r.year || 0;
    };

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

    const currentActiveId = this.filteredRecords[this.crate?.currentIndex]?.id || null;
    this.filteredRecords = list;
    this.crate.setRecords(list, this.currentSort, currentActiveId);
    const activeRecord = list[this.crate.currentIndex] || null;
    this.updateActiveMetadata(activeRecord);
  }

  onCrateIndexChange(currIndex, total, currentRecord) {
    const nextId = currentRecord?.id || null;
    if (nextId === this.lastMetaRecordId) {
      this.updateActiveMetadata(currentRecord);
      return;
    }

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

  setGlow(url) {
    if (this.glowLayers.length < 2 || url === this.glowUrl) return;
    this.glowUrl = url;

    if (!url) {
      this.glowLayers.forEach((l) => { l.style.opacity = '0'; });
      return;
    }

    const next = (this.glowActive + 1) % 2;
    const incoming = this.glowLayers[next];
    const outgoing = this.glowLayers[this.glowActive];
    const show = () => {
      if (this.glowUrl !== url) return;
      incoming.style.opacity = '0.32';
      if (outgoing) outgoing.style.opacity = '0';
      this.glowActive = next;
    };

    incoming.onload = show;
    incoming.src = url;
    if (incoming.complete && incoming.naturalWidth > 0) show();
  }

  updateActiveMetadata(record) {
    this.lastMetaRecordId = record?.id || null;

    this.setGlow(record?.artwork?.highRes || record?.artwork?.thumbnail || '');

    if (!record) {
      if (this.metaTitle) this.metaTitle.textContent = 'No records in crate';
      if (this.metaArtist) this.metaArtist.textContent = '—';
      if (this.metaYear) this.metaYear.textContent = '';
      if (this.metaDuration) this.metaDuration.textContent = '';
      if (this.metaGenres) this.metaGenres.innerHTML =  /*html*/ '';
      if (this.metaTrackSummary) this.metaTrackSummary.textContent = '';
      return;
    }

    if (this.metaTitle) this.metaTitle.textContent = record.title || 'Untitled';
    if (this.metaArtist) this.metaArtist.textContent = record.artist || 'Unknown Artist';
    const primaryYear = (record.year && record.masterYear && record.year !== record.masterYear)
      ? record.year
      : (record.masterYear || record.originalYear || record.year);
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
    document.title = record ? `${record.title} — ${record.artist} · Crate` : DEFAULT_TITLE;
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

  async handleSync() {
    // Typed-in token: save it first (this is the fallback path; signed-in users skip straight to syncing)
    if (discogsState().mode !== 'oauth') {
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
    if (!(await this.claimCrateFor(username))) {
      this.setSyncStatus('Sync cancelled. Your crate is unchanged.', '');
      return;
    }

    const buttons = [this.syncBtn, this.syncTokenBtn].filter(Boolean);
    buttons.forEach((b) => { b.disabled = true; });
    this.setSyncStatus('Starting Discogs collection sync...', '');

    try {
      await syncDiscogsCollection(username, ({ page, totalPages, count }) => {
        this.setSyncStatus(`Syncing page ${page} of ${totalPages} (${count} albums)...`, '');
      });

      const stale = (await getAllRecords()).filter((r) => String(r.id).startsWith('discogs_mock_'));
      if (stale.length > 0) await deleteRecords(stale.map((r) => r.id));

      this.setSyncStatus('Sync complete! Crate updated.', 'success');
      await this.loadAllRecords();
      // One request per release supplies its details and tracklist; durations still missing are filled from the master after
      this.fillMissingDetails().then(() => this.fillMissingTracklists());
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

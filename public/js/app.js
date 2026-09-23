// app.js - Main application coordinator
import { openDB, getAllRecords, clearRecords, deleteRecords, countRecords, getRecord, upsertRecords } from './db.js';
import { seedDefaultRecordsIfEmpty, resetToMockRecords, MOCK_RECORDS } from './mock-data.js';
import { CrateController } from './crate.js';
import { GatefoldController } from './notes.js';
import { syncDiscogsCollection, enrichTracklistsInBackground, enrichGenresInBackground, groupTracksBySide, calculateTotalDuration, parseSortArtist, getGenreTags, getRecordTags } from './sync.js';

const MAX_GENRE_TABS = 6;

// Shorter names for the tabs and meta line where Discogs' are long
const TAG_LABELS = {
  'Funk / Soul': 'Soul & Funk',
  'Folk, World, & Country': 'Folk & World',
};

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

    this.gatefold = new GatefoldController();
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
        this.settingsDrawer.classList.add('open');
        this.settingsDrawer.setAttribute('aria-hidden', 'false');
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
    this.fillMissingTracklists();
    this.fillMissingGenres();
  }

  async loadAllRecords() {
    this.allRecords = await getAllRecords();
    this.renderVibeTabs();
    this.applyFiltersAndSort();
  }

  tagLabel(tag) {
    return TAG_LABELS[tag] || tag;
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
      .map((tag) => `<button class="vibe-pill" data-vibe="${this.escapeHTML(tag)}">${this.escapeHTML(this.tagLabel(tag))}</button>`)
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

  fillMissingGenres() {
    const needsGenre = this.allRecords.filter((r) => !r.genreChecked);
    if (needsGenre.length === 0) return;

    enrichGenresInBackground(needsGenre).then(() => this.loadAllRecords());
  }

  fillMissingTracklists() {
    const token = localStorage.getItem('discogs_token');
    if (!token) return;

    const needsEnrichment = this.allRecords.filter((r) => {
      if (!r.discogsId) return false;
      if (!r.tracklist || r.tracklist.length === 0) return true;
      return r.tracklist.some((t) => !t.duration);
    });
    if (needsEnrichment.length === 0) return;

    enrichTracklistsInBackground(needsEnrichment, token).then(() => this.loadAllRecords());
  }

  setBrowseOpen(open) {
    document.body.classList.toggle('browse-open', open);
    if (this.browseToggleBtn) this.browseToggleBtn.setAttribute('aria-expanded', String(open));
  }

  applyFiltersAndSort() {
    let list = [...this.allRecords];

    // Filter by tag: a record shows under every genre tag it carries
    if (this.activeVibe !== 'all') {
      const target = this.activeVibe.toLowerCase();
      list = list.filter((r) => getGenreTags(r).some((t) => t.toLowerCase() === target));
    }

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
      const tags = getRecordTags(record).slice(0, 3).map((t) => this.tagLabel(t));
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

  openRecordDetail(record) {
    if (this.gatefold) {
      this.gatefold.openGatefold(record);
    }
  }

  async handleSync() {
    const username = this.usernameInput?.value.trim();
    const token = this.tokenInput?.value.trim();

    if (!username || !token) {
      this.setSyncStatus('Please provide both username and personal token.', 'error');
      return;
    }

    localStorage.setItem('discogs_username', username);
    localStorage.setItem('discogs_token', token);

    this.syncBtn.disabled = true;
    this.setSyncStatus('Starting Discogs collection sync...', '');

    try {
      await syncDiscogsCollection(username, token, ({ page, totalPages, count }) => {
        this.setSyncStatus(`Syncing page ${page} of ${totalPages} (${count} albums)...`, '');
      });

      const stale = (await getAllRecords()).filter((r) => String(r.id).startsWith('discogs_mock_'));
      if (stale.length > 0) await deleteRecords(stale.map((r) => r.id));

      this.setSyncStatus('Sync complete! Crate updated.', 'success');
      await this.loadAllRecords();
    } catch (err) {
      console.error(err);
      this.setSyncStatus(`Sync failed: ${err.message}`, 'error');
    } finally {
      this.syncBtn.disabled = false;
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

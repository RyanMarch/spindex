// app.js - Main application coordinator
import { openDB, getAllRecords, clearRecords, deleteRecords, countRecords, getRecord, upsertRecords } from './db.js';
import { seedDefaultRecordsIfEmpty, resetToMockRecords, MOCK_RECORDS } from './mock-data.js';
import { CrateController } from './crate.js';
import { GatefoldController } from './notes.js';
import { syncDiscogsCollection, enrichTracklistsInBackground, groupTracksBySide, calculateTotalDuration, parseSortArtist } from './sync.js';
import { soundFx } from './audio.js';

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
    this.nowSpinningRecord = null;
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

    this.vibePills = document.querySelectorAll('.vibe-pill');

    this.audioToggleBtn = document.getElementById('audio-toggle-btn');
    this.audioIconOn = document.getElementById('audio-icon-on');
    this.audioIconOff = document.getElementById('audio-icon-off');

    this.nowSpinningPill = document.getElementById('now-spinning-pill');
    this.spinText = document.getElementById('spin-text');

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
    this.metaTracklist = document.getElementById('meta-tracklist-preview');
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

    this.updateAudioIcon();
  }

  initControllers() {
    this.crate = new CrateController(
      this.stackContainer,
      this.counterEl,
      (record) => this.openRecordDetail(record),
      (currIndex, total, currentRecord) => this.onCrateIndexChange(currIndex, total, currentRecord)
    );

    this.gatefold = new GatefoldController({
      onNowSpinning: (record) => this.setNowSpinning(record),
    });
  }

  initEvents() {
    // Audio toggle
    if (this.audioToggleBtn) {
      this.audioToggleBtn.addEventListener('click', () => {
        soundFx.toggleMute();
        this.updateAudioIcon();
        if (!soundFx.isMuted()) {
          soundFx.playFlip();
        }
      });
    }

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

    // Vibe filter pills
    this.vibePills.forEach((pill) => {
      pill.addEventListener('click', () => {
        this.vibePills.forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        this.activeVibe = pill.dataset.vibe || 'all';
        this.applyFiltersAndSort();
      });
    });

    // Now spinning pill click opens ambient display
    if (this.nowSpinningPill) {
      this.nowSpinningPill.addEventListener('click', () => {
        if (this.nowSpinningRecord && this.gatefold) {
          this.gatefold.openAmbientTurntable(this.nowSpinningRecord);
        }
      });
    }

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
          localStorage.removeItem('now_spinning_id');
          this.nowSpinningRecord = null;
          this.updateNowSpinningUI();
          await this.loadAllRecords();
          this.closeSettings();
        }
      });
    }
  }

  updateAudioIcon() {
    const muted = soundFx.isMuted();
    if (this.audioIconOn && this.audioIconOff) {
      this.audioIconOn.style.display = muted ? 'none' : 'block';
      this.audioIconOff.style.display = muted ? 'block' : 'none';
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

    await this.restoreNowSpinning();
    await this.loadAllRecords();
    this.fillMissingTracklists();
  }

  async loadAllRecords() {
    this.allRecords = await getAllRecords();
    this.applyFiltersAndSort();
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

  applyFiltersAndSort() {
    let list = [...this.allRecords];

    // Filter by vibe
    if (this.activeVibe === 'picks') {
      list = list.filter((r) => Boolean(r.notes));
    } else if (this.activeVibe !== 'all') {
      const target = this.activeVibe.toLowerCase();
      list = list.filter((r) => {
        const matchesGenre = (r.genres || []).some((g) => g.toLowerCase().includes(target));
        const matchesStyle = (r.styles || []).some((s) => s.toLowerCase().includes(target));
        return matchesGenre || matchesStyle;
      });
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
        const gA = (a.genres && a.genres[0]) || 'Other';
        const gB = (b.genres && b.genres[0]) || 'Other';
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
    if (this.nowSpinningRecord && this.crate) {
      this.crate.setNowSpinningId(this.nowSpinningRecord.id);
    }
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
      if (this.metaTracklist) this.metaTracklist.innerHTML =  /*html*/ '';
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
      const tags = [...(record.genres || []), ...(record.styles || [])].slice(0, 3);
      this.metaGenres.innerHTML =  /*html*/ tags
        .map((t) => `<span class="meta-genre-tag">${this.escapeHTML(t)}</span>`)
        .join('');
    }

    if (this.metaTracklist) {
      this.metaTracklist.innerHTML =  /*html*/ this.renderMetaTracklistHTML(record.tracklist || []);
    }
  }

  renderMetaTracklistHTML(tracks) {
    if (!tracks || tracks.length === 0) return '';

    const sides = groupTracksBySide(tracks);

    if (sides && sides.length > 0) {
      let html = '<div class="meta-sides-grid">';
      for (const side of sides) {
        html += `<div class="meta-side-col"><div class="meta-side-hdr">${this.escapeHTML(side.title)}</div><ul class="meta-tracks">`;
        for (const t of side.tracks) {
          html += `<li><span class="mt-pos">${this.escapeHTML(t.position || '·')}</span><span class="mt-name">${this.escapeHTML(t.title)}</span></li>`;
        }
        html += '</ul></div>';
      }
      html += '</div>';
      return html;
    }

    return `<ul class="meta-tracks">${tracks.map((t) =>
      `<li><span class="mt-pos">${this.escapeHTML(t.position || '·')}</span><span class="mt-name">${this.escapeHTML(t.title)}</span></li>`
    ).join('')}</ul>`;
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

  setNowSpinning(record) {
    this.nowSpinningRecord = record;
    if (record) {
      localStorage.setItem('now_spinning_id', record.id);
    } else {
      localStorage.removeItem('now_spinning_id');
    }
    this.updateNowSpinningUI();
    if (this.crate) {
      this.crate.setNowSpinningId(record ? record.id : null);
    }
  }

  async restoreNowSpinning() {
    const savedId = localStorage.getItem('now_spinning_id');
    if (savedId) {
      const rec = await getRecord(savedId);
      if (rec) {
        this.nowSpinningRecord = rec;
        this.updateNowSpinningUI();
        if (this.crate) {
          this.crate.setNowSpinningId(rec.id);
        }
      }
    }
  }

  updateNowSpinningUI() {
    if (!this.nowSpinningPill || !this.spinText) return;

    if (this.nowSpinningRecord) {
      this.spinText.textContent = `${this.nowSpinningRecord.artist} - ${this.nowSpinningRecord.title}`;
      this.nowSpinningPill.style.display = 'flex';
    } else {
      this.nowSpinningPill.style.display = 'none';
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

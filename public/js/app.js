// app.js - Main application coordinator
import { openDB, getAllRecords, clearRecords, countRecords, getRecord, upsertRecords } from './db.js';
import { seedDefaultRecordsIfEmpty, resetToMockRecords, MOCK_RECORDS } from './mock-data.js';
import { CrateController } from './crate.js';
import { RecordDetailModal } from './notes.js';
import { syncDiscogsCollection } from './sync.js';
import { soundFx } from './audio.js';

// Service worker registration
if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('ServiceWorker registration error:', err);
    });
  });
}

class App {
  constructor() {
    this.crate = null;
    this.detailModal = null;
    this.currentSort = 'artist';
    this.activeVibe = 'all';
    this.allRecords = [];
    this.filteredRecords = [];
    this.nowSpinningRecord = null;

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

    const recordModalEl = document.getElementById('record-modal');
    this.detailModal = new RecordDetailModal(recordModalEl, (record) => {
      this.setNowSpinning(record);
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

    // Now spinning pill click opens modal
    if (this.nowSpinningPill) {
      this.nowSpinningPill.addEventListener('click', () => {
        if (this.nowSpinningRecord) {
          this.detailModal.open(this.nowSpinningRecord);
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

    // Check if mock records need verified artwork update
    const sample = await getRecord('discogs_mock_001');
    if (sample && sample.artwork?.thumbnail?.includes('wikimedia')) {
      await upsertRecords(MOCK_RECORDS);
    }

    await this.restoreNowSpinning();
    await this.loadAllRecords();
  }

  async loadAllRecords() {
    this.allRecords = await getAllRecords('by_artist');
    this.applyFiltersAndSort();
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

    // Sort list
    if (this.currentSort === 'artist') {
      list.sort((a, b) => (a.sortArtist || a.artist || '').localeCompare(b.sortArtist || b.artist || ''));
    } else if (this.currentSort === 'year') {
      list.sort((a, b) => (a.year || 0) - (b.year || 0));
    } else if (this.currentSort === 'added') {
      list.sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0));
    } else if (this.currentSort === 'genre') {
      list.sort((a, b) => {
        const gA = (a.genres && a.genres[0]) || 'Other';
        const gB = (b.genres && b.genres[0]) || 'Other';
        const comp = gA.localeCompare(gB);
        if (comp !== 0) return comp;
        return (a.sortArtist || '').localeCompare(b.sortArtist || '');
      });
    }

    this.filteredRecords = list;
    this.crate.setRecords(list, this.currentSort);
  }

  onCrateIndexChange(currIndex, total, currentRecord) {
    // Index change hook for external listeners if needed
  }

  openRecordDetail(record) {
    if (this.detailModal) {
      this.detailModal.open(record);
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
  }

  async restoreNowSpinning() {
    const savedId = localStorage.getItem('now_spinning_id');
    if (savedId) {
      const rec = await getRecord(savedId);
      if (rec) {
        this.nowSpinningRecord = rec;
        this.updateNowSpinningUI();
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

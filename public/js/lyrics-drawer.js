// lyrics-drawer.js - Controls the slide-over lyric sheet component
import { fetchLyrics, formatLyricsHTML, escapeHTML } from './lyrics.js';

export class LyricsDrawer {
  constructor() {
    this.drawerEl = document.getElementById('lyrics-drawer');
    this.cardEl = this.drawerEl?.querySelector('.lyrics-card');
    this.titleEl = document.getElementById('lyrics-title');
    this.subtitleEl = document.getElementById('lyrics-subtitle');
    this.posEl = document.getElementById('lyrics-pos');
    this.bodyEl = document.getElementById('lyrics-body');
    this.prevBtn = document.getElementById('lyrics-prev-btn');
    this.nextBtn = document.getElementById('lyrics-next-btn');
    this.countEl = document.getElementById('lyrics-track-count');
    this.pickerBtn = document.getElementById('lyrics-track-picker-btn');
    this.menuEl = document.getElementById('lyrics-track-menu');
    this.menuListEl = document.getElementById('lyrics-track-menu-list');
    this.closeBtn = document.getElementById('lyrics-close-btn');
    this.geniusLink = document.getElementById('lyrics-genius-fallback');

    this.record = null;
    this.trackIndex = 0;
    this.activeRequestId = 0;
    this.lastTriggerBtn = null;

    this.bindEvents();
  }

  bindEvents() {
    if (!this.drawerEl) return;

    this.closeBtn?.addEventListener('click', () => this.close());
    this.prevBtn?.addEventListener('click', () => this.step(-1));
    this.nextBtn?.addEventListener('click', () => this.step(1));
    this.pickerBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMenu();
    });

    this.menuListEl?.addEventListener('click', (e) => {
      const item = e.target.closest('[data-track-index]');
      if (!item) return;
      const idx = parseInt(item.dataset.trackIndex, 10);
      this.closeMenu();
      this.trackIndex = idx;
      this.loadTrack(idx);
    });

    document.addEventListener('click', (e) => {
      if (!this.menuEl?.contains(e.target) && !this.pickerBtn?.contains(e.target)) {
        this.closeMenu();
      }
    });

    // Light dismiss: clicking outside the card closes the drawer
    this.drawerEl.addEventListener('click', (e) => {
      if (e.target === this.drawerEl) {
        this.close();
      }
    });

    // Keyboard navigation
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen()) return;

      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      } else if (e.key === 'ArrowLeft') {
        e.stopPropagation();
        this.step(-1);
      } else if (e.key === 'ArrowRight') {
        e.stopPropagation();
        this.step(1);
      }
    });

    // Touch: pull-down gesture to dismiss on mobile
    let touchStart = null;
    this.cardEl?.addEventListener('touchstart', (e) => {
      if (this.bodyEl.scrollTop === 0 || !this.bodyEl.contains(e.target)) {
        touchStart = { y: e.touches[0].clientY, x: e.touches[0].clientX };
      } else {
        touchStart = null;
      }
    }, { passive: true });

    this.cardEl?.addEventListener('touchend', (e) => {
      if (!touchStart) return;
      const touchEnd = e.changedTouches[0];
      const dy = touchEnd.clientY - touchStart.y;
      const dx = touchEnd.clientX - touchStart.x;
      // Downward swipe of at least 80px, predominantly vertical
      if (dy > 80 && dy > Math.abs(dx) * 1.5 && (this.bodyEl.scrollTop === 0 || !this.bodyEl.contains(e.target))) {
        this.close();
      }
      touchStart = null;
    }, { passive: true });
  }

  isOpen() {
    return Boolean(this.drawerEl?.classList.contains('open'));
  }

  open(record, trackIndex = 0, triggerBtn = null) {
    if (!this.drawerEl || !record) return;

    this.record = record;
    this.trackIndex = Math.max(0, Math.min(trackIndex, (record.tracklist?.length || 1) - 1));
    this.lastTriggerBtn = triggerBtn;

    this.drawerEl.classList.add('open');
    this.drawerEl.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lyrics-open');

    this.loadTrack(this.trackIndex);
    this.closeBtn?.focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen()) return;

    this.drawerEl.classList.remove('open');
    this.drawerEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lyrics-open');
    document.querySelectorAll('.gf-lyrics[data-active="true"]').forEach((el) => el.removeAttribute('data-active'));
    this.activeRequestId += 1;

    this.closeMenu();
    // Restore focus to the button that opened the drawer
    if (this.lastTriggerBtn && typeof this.lastTriggerBtn.focus === 'function') {
      this.lastTriggerBtn.focus({ preventScroll: true });
    }
  }

  toggleMenu() {
    if (!this.menuEl) return;
    if (this.menuEl.hidden) {
      this.openMenu();
    } else {
      this.closeMenu();
    }
  }

  openMenu() {
    if (!this.menuEl || !this.record) return;
    this.renderTrackMenu();
    this.menuEl.hidden = false;
    this.pickerBtn?.classList.add('active');
  }

  closeMenu() {
    if (!this.menuEl) return;
    this.menuEl.hidden = true;
    this.pickerBtn?.classList.remove('active');
  }

  renderTrackMenu() {
    if (!this.menuListEl || !this.record) return;
    const tracks = this.record.tracklist || [];
    const items = tracks.map((t, idx) => {
      const active = idx === this.trackIndex;
      return `<li class="lyrics-track-menu-item${active ? ' active' : ''}" data-track-index="${idx}">
        <span class="lyrics-track-menu-pos">${escapeHTML(t.position || String(idx + 1))}</span>
        <span class="lyrics-track-menu-title">${escapeHTML(t.title || 'Untitled')}</span>
        ${t.duration ? `<span class="lyrics-track-menu-dur">${escapeHTML(t.duration)}</span>` : ''}
      </li>`;
    });
    this.menuListEl.innerHTML =  /*html*/ items.join('');
  }

  step(delta) {
    const tracks = this.record?.tracklist || [];
    if (tracks.length === 0) return;

    const nextIndex = this.trackIndex + delta;
    if (nextIndex >= 0 && nextIndex < tracks.length) {
      this.trackIndex = nextIndex;
      this.loadTrack(this.trackIndex);
    }
  }

  geniusUrl(record, track) {
    const artist = escapeHTML(record?.artist || '');
    const title = escapeHTML(track?.title || '');
    return `https://genius.com/search?q=${encodeURIComponent(`${artist} ${title}`)}`;
  }

  async loadTrack(index) {
    const tracks = this.record?.tracklist || [];
    const track = tracks[index];
    if (!track) return;

    const total = tracks.length;
    const reqId = ++this.activeRequestId;
    this.closeMenu();

    // Update active indicator on tracklist
    document.querySelectorAll('.gf-lyrics[data-active="true"]').forEach((el) => el.removeAttribute('data-active'));
    const activeBtn = document.querySelector(`.gf-lyrics[data-track-index="${index}"]`);
    if (activeBtn) activeBtn.setAttribute('data-active', 'true');

    // Update Header
    if (this.posEl) this.posEl.textContent = track.position || `Track ${index + 1}`;
    if (this.titleEl) this.titleEl.textContent = track.title || 'Untitled Track';
    if (this.subtitleEl) {
      this.subtitleEl.textContent = `${this.record.artist || 'Unknown Artist'} · ${this.record.title || ''}`;
    }

    // Update Stepper
    if (this.countEl) this.countEl.textContent = `${index + 1} of ${total}`;
    if (this.prevBtn) {
      this.prevBtn.disabled = index === 0;
      this.prevBtn.setAttribute('aria-disabled', String(index === 0));
    }
    if (this.nextBtn) {
      this.nextBtn.disabled = index === total - 1;
      this.nextBtn.setAttribute('aria-disabled', String(index === total - 1));
    }

    // Update Genius link
    if (this.geniusLink) {
      this.geniusLink.href = this.geniusUrl(this.record, track);
      this.geniusLink.textContent = `Search lyrics on Genius ↗`;
    }

    // Reset card scroll
    if (this.bodyEl) this.bodyEl.scrollTop = 0;

    // Render loading skeleton
    if (this.bodyEl) {
      this.bodyEl.innerHTML =  /*html*/ `
        <div class="lyrics-loading" aria-busy="true">
          <div class="lyrics-skeleton-line" style="width: 70%"></div>
          <div class="lyrics-skeleton-line" style="width: 85%"></div>
          <div class="lyrics-skeleton-line" style="width: 60%"></div>
          <div class="lyrics-skeleton-line" style="width: 75%"></div>
          <div class="lyrics-skeleton-gap"></div>
          <div class="lyrics-skeleton-line" style="width: 80%"></div>
          <div class="lyrics-skeleton-line" style="width: 65%"></div>
          <div class="lyrics-skeleton-line" style="width: 90%"></div>
          <div class="lyrics-skeleton-line" style="width: 70%"></div>
        </div>
      `;
    }

    // Fetch lyrics
    const result = await fetchLyrics({
      artist: this.record.artist,
      title: track.title,
      album: this.record.title,
      duration: track.duration,
    });

    // Check race condition
    if (reqId !== this.activeRequestId) return;

    if (!this.bodyEl) return;

    if (result.instrumental) {
      this.bodyEl.innerHTML =  /*html*/ `
        <div class="lyrics-state lyrics-instrumental">
          <div class="lyrics-state-icon">
            <svg viewBox="0 0 24 24" width="36" height="36" stroke="currentColor" fill="none" stroke-width="1.8">
              <circle cx="12" cy="12" r="10"></circle>
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M12 2a10 10 0 0 1 10 10"></path>
            </svg>
          </div>
          <h4>Instrumental</h4>
          <p>This track is marked as an instrumental piece with no lyrics.</p>
        </div>
      `;
      return;
    }

    if (result.found && result.plainLyrics) {
      this.bodyEl.innerHTML =  /*html*/ formatLyricsHTML(result.plainLyrics);
      return;
    }

    if (result.rateLimited) {
      this.bodyEl.innerHTML =  /*html*/ `
        <div class="lyrics-state">
          <h4>Rate limit reached</h4>
          <p>Too many requests to the lyrics service. Please wait a moment and try again.</p>
        </div>
      `;
      return;
    }

    // Not found
    this.bodyEl.innerHTML =  /*html*/ `
      <div class="lyrics-state lyrics-not-found">
        <div class="lyrics-state-icon">
          <svg viewBox="0 0 24 24" width="36" height="36" stroke="currentColor" fill="none" stroke-width="1.8">
            <path d="M9 18V5l12-2v13"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="16" r="3"></circle>
          </svg>
        </div>
        <h4>No lyrics found</h4>
        <p>Lyrics are not available for this track on LRCLIB.</p>
        <a class="btn lyrics-action-btn" href="${escapeHTML(this.geniusUrl(this.record, track))}" target="_blank" rel="noopener">
          Search on Genius ↗
        </a>
      </div>
    `;
  }
}

let lyricsDrawerInstance = null;

export function getLyricsDrawer() {
  if (!lyricsDrawerInstance) {
    lyricsDrawerInstance = new LyricsDrawer();
  }
  return lyricsDrawerInstance;
}

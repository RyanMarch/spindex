// notes.js - Inline Gatefold inspection & Now Spinning ambient display controller
import { updateRecord } from './db.js';
import { soundFx } from './audio.js';
import { groupTracksBySide } from './sync.js';

export class GatefoldController {
  constructor({ onNowSpinning } = {}) {
    this.activeRecord = null;
    this.onNowSpinning = onNowSpinning;

    // Gatefold elements
    this.workspace = document.getElementById('gatefold-workspace');
    this.backBtn = document.getElementById('gatefold-back-btn');
    this.jacketArt = document.getElementById('gatefold-jacket-art');
    this.labelArt = document.getElementById('gatefold-label-art');
    this.vinylDisc = document.getElementById('gatefold-vinyl-disc');
    this.titleEl = document.getElementById('gatefold-title');
    this.artistEl = document.getElementById('gatefold-artist');
    this.yearEl = document.getElementById('gatefold-year');
    this.tracklistEl = document.getElementById('gatefold-tracklist');
    this.wikiEl = document.getElementById('gatefold-wiki');
    this.spinBtn = document.getElementById('gatefold-spin-btn');

    // Ambient turntable elements
    this.ambientEl = document.getElementById('ambient-turntable');
    this.ambientRoomGlow = document.getElementById('ambient-room-glow');
    this.turntableVinyl = document.getElementById('turntable-vinyl');
    this.turntableLabelArt = document.getElementById('turntable-label-art');
    this.ambientCoverArt = document.getElementById('ambient-cover-art');
    this.ambientTitle = document.getElementById('ambient-title');
    this.ambientArtist = document.getElementById('ambient-artist');
    this.ambientTimer = document.getElementById('ambient-timer');
    this.ambientProgress = document.getElementById('ambient-needle-progress');
    this.ambientExitBtn = document.getElementById('ambient-exit-btn');

    this._timerInterval = null;
    this._timerSeconds = 0;

    this.bindEvents();
  }

  bindEvents() {
    if (this.backBtn) {
      this.backBtn.addEventListener('click', () => this.closeGatefold());
    }

    if (this.spinBtn) {
      this.spinBtn.addEventListener('click', () => {
        if (!this.activeRecord) return;
        soundFx.playNeedleDrop();
        if (this.onNowSpinning) this.onNowSpinning(this.activeRecord);
        this.closeGatefold();
        this.openAmbientTurntable(this.activeRecord);
      });
    }

    if (this.ambientExitBtn) {
      this.ambientExitBtn.addEventListener('click', () => this.closeAmbientTurntable());
    }

    // Swipe-down to close gatefold
    let touchStartY = 0;
    if (this.workspace) {
      this.workspace.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
      }, { passive: true });

      this.workspace.addEventListener('touchend', (e) => {
        const deltaY = e.changedTouches[0].clientY - touchStartY;
        if (deltaY > 60) this.closeGatefold();
      }, { passive: true });
    }

    // Escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.workspace?.classList.contains('open')) this.closeGatefold();
        else if (this.ambientEl?.classList.contains('open')) this.closeAmbientTurntable();
      }
    });
  }

  async openGatefold(record) {
    this.activeRecord = record;
    this.renderGatefoldBasic(record);

    if (this.workspace) {
      this.workspace.classList.add('open');
      this.workspace.setAttribute('aria-hidden', 'false');
    }

    // Trigger vinyl disc slide-out slightly after open
    setTimeout(() => {
      if (this.vinylDisc) this.vinylDisc.classList.add('ejected');
    }, 180);

    if (!record.context) {
      await this.fetchLinerNotes(record);
    } else {
      this.renderLinerNotes(record.context);
    }
  }

  closeGatefold() {
    if (this.vinylDisc) this.vinylDisc.classList.remove('ejected');

    if (this.workspace) {
      this.workspace.classList.remove('open');
      this.workspace.setAttribute('aria-hidden', 'true');
    }
  }

  renderGatefoldBasic(record) {
    const artUrl = record.artwork?.highRes || record.artwork?.thumbnail || '';

    if (this.jacketArt) {
      this.jacketArt.src = artUrl;
      this.jacketArt.alt = `${record.artist} – ${record.title}`;
    }
    if (this.labelArt) this.labelArt.src = artUrl;

    if (this.titleEl) this.titleEl.textContent = record.title || '';
    if (this.artistEl) this.artistEl.textContent = record.artist || '';
    if (this.yearEl) this.yearEl.textContent = record.year ? `${record.year}` : '';

    if (this.tracklistEl) {
      this.tracklistEl.innerHTML =  /*html*/ this.renderTracklistHTML(record.tracklist || []);
    }

    if (this.wikiEl) {
      this.wikiEl.innerHTML =  /*html*/ '<p class="gatefold-loading">Reading from archives...</p>';
    }

    if (this.spinBtn) {
      this.spinBtn.textContent = '● Spin Album';
      this.spinBtn.classList.remove('active');
    }
  }

  renderLinerNotes(context) {
    if (this.wikiEl) {
      this.wikiEl.innerHTML =  /*html*/ context.wikiExtract || '<p class="gatefold-empty">No additional sleeve notes found in the archives.</p>';
    }
  }

  async fetchLinerNotes(record) {
    try {
      const searchTarget = encodeURIComponent(`${record.artist} ${record.title}`);
      let res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${searchTarget}`);

      if (!res.ok) {
        const artistTarget = encodeURIComponent(record.artist);
        res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${artistTarget}`);
      }

      if (!res.ok) throw new Error('No summary found');

      const data = await res.json();
      const context = {
        wikiExtract: data.extract_html || `<p>${data.extract || ''}</p>`,
        wikiUrl: data.content_urls?.desktop?.page || '',
        wikiImage: data.originalimage?.source || data.thumbnail?.source || null,
      };

      await updateRecord(record.id, { context });

      if (this.activeRecord && this.activeRecord.id === record.id) {
        this.activeRecord.context = context;
        this.renderLinerNotes(context);
      }
    } catch {
      if (this.wikiEl) {
        this.wikiEl.innerHTML =  /*html*/ '<p class="gatefold-empty">No additional sleeve notes found in the archives.</p>';
      }
    }
  }

  renderTracklistHTML(tracks) {
    if (!tracks || tracks.length === 0) {
      return '<p class="gatefold-empty">No tracklist provided.</p>';
    }

    const sides = groupTracksBySide(tracks);

    if (sides && sides.length > 0) {
      let html = '<div class="gatefold-sides-grid">';
      for (const side of sides) {
        html += `<div class="gatefold-side-col"><div class="gatefold-side-hdr">${this.escapeHTML(side.title)}</div><ul class="gatefold-tracks">`;
        for (const t of side.tracks) {
          html += `<li><span class="gf-tpos">${this.escapeHTML(t.position || '·')}</span><span class="gf-tname">${this.escapeHTML(t.title)}</span><span class="gf-ttime">${this.escapeHTML(t.duration || '')}</span></li>`;
        }
        html += '</ul></div>';
      }
      html += '</div>';
      return html;
    }

    return `<ul class="gatefold-tracks">${tracks.map((t) =>
      `<li><span class="gf-tpos">${this.escapeHTML(t.position || '·')}</span><span class="gf-tname">${this.escapeHTML(t.title)}</span><span class="gf-ttime">${this.escapeHTML(t.duration || '')}</span></li>`
    ).join('')}</ul>`;
  }

  // --------------------------------------------------------
  // Ambient Turntable Display
  // --------------------------------------------------------

  openAmbientTurntable(record) {
    const artUrl = record.artwork?.highRes || record.artwork?.thumbnail || '';

    if (this.turntableLabelArt) this.turntableLabelArt.src = artUrl;
    if (this.ambientCoverArt) {
      this.ambientCoverArt.src = artUrl;
      this.ambientCoverArt.alt = `${record.artist} – ${record.title}`;
    }
    if (this.ambientTitle) this.ambientTitle.textContent = record.title || '';
    if (this.ambientArtist) this.ambientArtist.textContent = record.artist || '';
    if (this.ambientTimer) this.ambientTimer.textContent = 'Side A';
    if (this.ambientProgress) this.ambientProgress.style.width = '0%';
    if (this.ambientRoomGlow) {
      this.ambientRoomGlow.style.backgroundImage = `url(${artUrl})`;
    }

    if (this.turntableVinyl) this.turntableVinyl.classList.add('spinning');

    this._timerSeconds = 0;
    clearInterval(this._timerInterval);
    this._timerInterval = setInterval(() => this._tickTimer(), 1000);

    if (this.ambientEl) {
      this.ambientEl.classList.add('open');
      this.ambientEl.setAttribute('aria-hidden', 'false');
    }
  }

  closeAmbientTurntable() {
    clearInterval(this._timerInterval);

    if (this.turntableVinyl) this.turntableVinyl.classList.remove('spinning');

    if (this.ambientEl) {
      this.ambientEl.classList.remove('open');
      this.ambientEl.setAttribute('aria-hidden', 'true');
    }
  }

  _tickTimer() {
    this._timerSeconds++;
    const m = Math.floor(this._timerSeconds / 60).toString().padStart(2, '0');
    const s = (this._timerSeconds % 60).toString().padStart(2, '0');
    if (this.ambientTimer) this.ambientTimer.textContent = `${m}:${s}`;

    // Animate needle progress bar (loops at 20 min per side)
    const pct = (this._timerSeconds % 1200) / 1200 * 100;
    if (this.ambientProgress) this.ambientProgress.style.width = `${pct}%`;
  }

  escapeHTML(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

// notes.js - Interactive vinyl inspection showcase and liner notes
import { updateRecord } from './db.js';
import { soundFx } from './audio.js';

export class RecordDetailModal {
  constructor(modalEl, onNowSpinning) {
    this.modal = modalEl;
    this.activeRecord = null;
    this.onNowSpinning = onNowSpinning;
    this.isSpinning = false;
    this.bindEvents();
  }

  bindEvents() {
    const closeBtns = this.modal.querySelectorAll('.modal-close, .btn-back-to-crate');
    closeBtns.forEach((btn) => {
      btn.addEventListener('click', () => this.close());
    });

    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modal.classList.contains('open')) {
        this.close();
      }
    });

    const spinBtn = this.modal.querySelector('#set-now-spinning-btn');
    if (spinBtn) {
      spinBtn.addEventListener('click', () => {
        if (!this.activeRecord) return;

        this.isSpinning = true;
        soundFx.playNeedleDrop();

        const discEl = this.modal.querySelector('.vinyl-disc');
        if (discEl) discEl.classList.add('spinning');

        if (this.onNowSpinning) {
          this.onNowSpinning(this.activeRecord);
        }

        spinBtn.textContent = 'Now Spinning';
        spinBtn.classList.add('btn-active');
      });
    }
  }

  async open(record) {
    this.activeRecord = record;
    this.isSpinning = false;
    this.renderBasic();
    this.modal.classList.add('open');
    this.modal.setAttribute('aria-hidden', 'false');

    // Trigger disc slide-out slightly after modal reveal for physical effect
    setTimeout(() => {
      const discEl = this.modal.querySelector('.vinyl-disc');
      if (discEl) discEl.classList.add('ejected');
    }, 120);

    if (!record.context) {
      await this.fetchWikimediaLinerNotes(record);
    } else {
      const wikiContainer = this.modal.querySelector('.wiki-body');
      if (wikiContainer) {
        wikiContainer.innerHTML =  /*html*/ record.context.wikiExtract || '<p class="wiki-empty">No additional liner notes available.</p>';
      }
    }
  }

  close() {
    const discEl = this.modal.querySelector('.vinyl-disc');
    if (discEl) {
      discEl.classList.remove('ejected', 'spinning');
    }
    this.modal.classList.remove('open');
    this.modal.setAttribute('aria-hidden', 'true');
  }

  renderBasic() {
    const { artist, title, year, artwork, notes, tracklist, genres, styles } = this.activeRecord;

    const coverEl = this.modal.querySelector('.showcase-jacket-art');
    const labelCoverEl = this.modal.querySelector('.disc-label-art');
    const titleEl = this.modal.querySelector('.showcase-title');
    const artistEl = this.modal.querySelector('.showcase-artist');
    const yearEl = this.modal.querySelector('.showcase-year');
    const noteEl = this.modal.querySelector('.host-note');
    const tagsEl = this.modal.querySelector('.showcase-tags');
    const tracklistEl = this.modal.querySelector('.modal-tracklist');
    const wikiContainer = this.modal.querySelector('.wiki-body');
    const spinBtn = this.modal.querySelector('#set-now-spinning-btn');

    const artUrl = artwork?.highRes || artwork?.thumbnail || '';

    if (coverEl) {
      coverEl.src = artUrl;
      coverEl.alt = `${artist} - ${title}`;
    }

    if (labelCoverEl) {
      labelCoverEl.src = artUrl;
    }

    if (titleEl) titleEl.textContent = title;
    if (artistEl) artistEl.textContent = artist;
    if (yearEl) yearEl.textContent = year ? `Original Release: ${year}` : '';

    if (spinBtn) {
      spinBtn.textContent = 'Spin Album';
      spinBtn.classList.remove('btn-active');
    }

    if (noteEl) {
      if (notes) {
        noteEl.innerHTML =  /*html*/ `<span class="note-label">Host Pick Recommendation</span><p>“${this.escapeHTML(notes)}”</p>`;
        noteEl.style.display = 'block';
      } else {
        noteEl.innerHTML =  /*html*/ '';
        noteEl.style.display = 'none';
      }
    }

    if (tagsEl) {
      const allTags = [...(genres || []), ...(styles || [])];
      if (allTags.length > 0) {
        tagsEl.innerHTML =  /*html*/ allTags.map((tag) => `<span class="tag-pill">${this.escapeHTML(tag)}</span>`).join('');
        tagsEl.style.display = 'flex';
      } else {
        tagsEl.innerHTML =  /*html*/ '';
        tagsEl.style.display = 'none';
      }
    }

    if (tracklistEl) {
      if (tracklist && tracklist.length > 0) {
        tracklistEl.innerHTML =  /*html*/ this.renderTracklistHTML(tracklist);
        tracklistEl.style.display = 'block';
      } else {
        tracklistEl.innerHTML =  /*html*/ '';
        tracklistEl.style.display = 'none';
      }
    }

    if (wikiContainer) {
      wikiContainer.innerHTML =  /*html*/ '<p class="wiki-loading">Reading from archives...</p>';
    }
  }

  renderTracklistHTML(tracks) {
    const sideA = tracks.filter((t) => t.position && t.position.startsWith('A'));
    const sideB = tracks.filter((t) => t.position && t.position.startsWith('B'));

    if (sideA.length > 0 || sideB.length > 0) {
      let html = '<div class="sides-grid">';
      if (sideA.length > 0) {
        html += '<div class="side-col"><div class="side-header"><span class="side-indicator">A</span><h4>Side One</h4></div><ul>';
        sideA.forEach((t) => {
          html += `<li><span class="track-pos">${this.escapeHTML(t.position)}</span> <span class="track-name">${this.escapeHTML(t.title)}</span> <span class="track-time">${this.escapeHTML(t.duration || '')}</span></li>`;
        });
        html += '</ul></div>';
      }
      if (sideB.length > 0) {
        html += '<div class="side-col"><div class="side-header"><span class="side-indicator">B</span><h4>Side Two</h4></div><ul>';
        sideB.forEach((t) => {
          html += `<li><span class="track-pos">${this.escapeHTML(t.position)}</span> <span class="track-name">${this.escapeHTML(t.title)}</span> <span class="track-time">${this.escapeHTML(t.duration || '')}</span></li>`;
        });
        html += '</ul></div>';
      }
      html += '</div>';
      return html;
    }

    return `<ul>${tracks.map((t) => `<li><span class="track-pos">${this.escapeHTML(t.position || '')}</span> <span class="track-name">${this.escapeHTML(t.title)}</span> <span class="track-time">${this.escapeHTML(t.duration || '')}</span></li>`).join('')}</ul>`;
  }

  async fetchWikimediaLinerNotes(record) {
    const wikiContainer = this.modal.querySelector('.wiki-body');
    try {
      const searchTarget = encodeURIComponent(`${record.artist} ${record.title}`);
      let res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${searchTarget}`);

      if (!res.ok) {
        const artistTarget = encodeURIComponent(record.artist);
        res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${artistTarget}`);
      }

      if (!res.ok) throw new Error('No Wikimedia summary found');

      const data = await res.json();
      const context = {
        wikiExtract: data.extract_html || `<p>${data.extract || ''}</p>`,
        wikiUrl: data.content_urls?.desktop?.page || '',
        wikiImage: data.originalimage?.source || data.thumbnail?.source || null,
      };

      await updateRecord(record.id, { context });
      if (this.activeRecord && this.activeRecord.id === record.id) {
        this.activeRecord.context = context;
        if (wikiContainer) {
          wikiContainer.innerHTML =  /*html*/ context.wikiExtract;
        }
      }
    } catch {
      if (wikiContainer) {
        wikiContainer.innerHTML =  /*html*/ '<p class="wiki-empty">No additional sleeve notes found in the archives.</p>';
      }
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

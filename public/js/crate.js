// crate.js - Vertical 3D Cover Flow with persistent element animations
import { soundFx } from './audio.js';

export class CrateController {
  constructor(containerEl, counterEl, onSelectRecord, onIndexChange) {
    this.container = containerEl;
    this.counter = counterEl;
    this.onSelect = onSelectRecord;
    this.onIndexChange = onIndexChange;
    this.records = [];
    this.sleeveElements = [];
    this.currentIndex = 0;
    this.visibleRange = 24; // Keep full crate collection visible without flying off
    this.sortKey = 'artist';

    this.bindEvents();
  }

  getStackStep(k) {
    if (k <= 0) return 0;
    if (k === 1) return 1.0;
    if (k === 2) return 1.85;
    if (k === 3) return 2.55;
    let sum = 2.55;
    for (let i = 4; i <= k; i++) {
      sum += 0.55 * Math.pow(0.75, i - 4);
    }
    return sum;
  }

  setRecords(records, sortKey = 'artist') {
    this.records = records || [];
    this.sortKey = sortKey;
    this.currentIndex = 0;
    this.buildSleeves();
  }

  setIndex(index, skipSound = false) {
    if (index >= 0 && index < this.records.length && index !== this.currentIndex) {
      this.currentIndex = index;
      if (!skipSound) soundFx.playFlip();
      this.updatePositions();
    }
  }

  buildSleeves() {
    this.container.innerHTML =  /*html*/ '';
    this.sleeveElements = [];
    const total = this.records.length;

    if (total === 0) {
      if (this.counter) this.counter.textContent = '0 / 0';
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'empty-crate-msg';
      emptyMsg.innerHTML =  /*html*/ '<p>Your record crate is empty.</p><small>Sync with Discogs or reload demo collection.</small>';
      this.container.appendChild(emptyMsg);
      if (this.onIndexChange) this.onIndexChange(0, 0, null);
      return;
    }

    // Build persistent sleeve DOM elements once so CSS transitions can animate between positions
    for (let i = 0; i < total; i++) {
      const record = this.records[i];
      const el = document.createElement('div');
      el.className = 'sleeve';
      el.dataset.index = String(i);

      // Record shop category divider tab
      const tabLabel = this.getDividerLabel(i);
      if (tabLabel) {
        const tabEl = document.createElement('div');
        tabEl.className = 'crate-divider-tab';
        const tabSlot = (i % 3);
        tabEl.classList.add(`tab-slot-${tabSlot}`);
        tabEl.textContent = tabLabel;
        el.appendChild(tabEl);
      }

      // Host pick sticky note badge
      if (record.notes) {
        const noteEl = document.createElement('div');
        noteEl.className = 'staff-pick-badge';
        noteEl.title = record.notes;
        noteEl.innerHTML =  /*html*/ '<span>Host Pick</span>';
        el.appendChild(noteEl);
      }

      // Solid jacket cover wrapper
      const coverWrap = document.createElement('div');
      coverWrap.className = 'sleeve-cover-wrap';

      // Cover artwork image
      const img = document.createElement('img');
      img.src = record.artwork?.highRes || record.artwork?.thumbnail || '';
      img.alt = `${record.artist} - ${record.title}`;
      img.loading = i <= 3 ? 'eager' : 'lazy';

      img.onerror = () => {
        img.style.display = 'none';
        const fallback = document.createElement('div');
        fallback.className = 'cover-fallback';
        fallback.innerHTML =  /*html*/ `<div class="fallback-artist">${this.escapeHTML(record.artist)}</div><div class="fallback-title">${this.escapeHTML(record.title)}</div>`;
        coverWrap.appendChild(fallback);
      };

      coverWrap.appendChild(img);

      // Faux spine accent
      const spine = document.createElement('div');
      spine.className = 'faux-spine';
      coverWrap.appendChild(spine);

      // Dynamic surface sheen
      const sheen = document.createElement('div');
      sheen.className = 'sleeve-sheen-overlay';
      coverWrap.appendChild(sheen);

      el.appendChild(coverWrap);

      // Card click handling
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (i === this.currentIndex) {
          if (this.onSelect) this.onSelect(record);
        } else {
          this.setIndex(i);
        }
      });

      this.container.appendChild(el);
      this.sleeveElements.push({ el, record, index: i });
    }

    this.updatePositions();
  }

  updatePositions() {
    const total = this.records.length;
    if (total === 0) return;

    if (this.counter) {
      this.counter.textContent = `${this.currentIndex + 1} / ${total}`;
    }

    if (this.onIndexChange) {
      this.onIndexChange(this.currentIndex, total, this.records[this.currentIndex]);
    }

    // Update continuous positions without destroying elements so CSS transitions animate smoothly
    for (const item of this.sleeveElements) {
      const offset = item.index - this.currentIndex;
      const absOffset = Math.abs(offset);
      const stackStep = this.getStackStep(absOffset);

      item.el.style.setProperty('--offset', String(offset));
      item.el.style.setProperty('--abs-offset', String(absOffset));
      item.el.style.setProperty('--stack-step', String(stackStep.toFixed(4)));

      if (absOffset > this.visibleRange + 1) {
        item.el.className = offset < 0 ? 'sleeve out-of-range flow-above' : 'sleeve out-of-range flow-below';
        item.el.style.zIndex = '0';
      } else if (offset === 0) {
        item.el.className = 'sleeve active';
        item.el.style.zIndex = '100';
      } else if (offset < 0) {
        item.el.className = 'sleeve flow-above';
        item.el.style.zIndex = String(Math.max(1, 99 - absOffset * 2));
      } else {
        item.el.className = 'sleeve flow-below';
        item.el.style.zIndex = String(Math.min(99, 50 + offset * 2));
      }
    }
  }

  getDividerLabel(index) {
    if (index === 0) return this.formatSectionValue(this.records[0]);

    const prev = this.records[index - 1];
    const curr = this.records[index];

    const prevVal = this.getSectionValue(prev);
    const currVal = this.getSectionValue(curr);

    return prevVal !== currVal ? currVal : null;
  }

  getSectionValue(record) {
    if (this.sortKey === 'genre') {
      return (record.genres && record.genres[0]) ? record.genres[0].toUpperCase() : 'OTHER';
    }
    if (this.sortKey === 'year') {
      if (!record.year) return 'UNKNOWN';
      const decade = Math.floor(record.year / 10) * 10;
      return `${decade}s`;
    }
    const name = record.sortArtist || record.artist || '';
    const char = name.trim().charAt(0).toUpperCase();
    return /[A-Z]/.test(char) ? char : '#';
  }

  formatSectionValue(record) {
    return this.getSectionValue(record);
  }

  next() {
    if (this.currentIndex < this.records.length - 1) {
      this.currentIndex++;
      soundFx.playFlip();
      this.updatePositions();
    }
  }

  prev() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      soundFx.playFlip();
      this.updatePositions();
    }
  }

  bindEvents() {
    // Keyboard navigation: Up/Left = prev, Down/Right = next
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (document.querySelector('.record-modal.open') || document.querySelector('.settings-drawer.open')) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        this.next();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        this.prev();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (this.records[this.currentIndex] && this.onSelect) {
          this.onSelect(this.records[this.currentIndex]);
        }
      }
    });

    // Touch swipe gestures
    let touchStartY = 0;
    let touchStartTime = 0;

    this.container.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      touchStartY = touch.clientY;
      touchStartTime = Date.now();
    }, { passive: true });

    this.container.addEventListener('touchend', (e) => {
      const touch = e.changedTouches[0];
      const deltaY = touch.clientY - touchStartY;
      const elapsedTime = Date.now() - touchStartTime;

      if (elapsedTime > 600) return;

      if (Math.abs(deltaY) > 28) {
        if (deltaY < 0) {
          this.next();
        } else {
          this.prev();
        }
      }
    }, { passive: true });

    // Vertical mouse wheel with momentum debounce
    let wheelDebounce = false;
    window.addEventListener('wheel', (e) => {
      if (document.querySelector('.record-modal.open') || document.querySelector('.settings-drawer.open')) return;
      if (wheelDebounce) return;

      const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;

      if (Math.abs(delta) > 14) {
        wheelDebounce = true;
        if (delta > 0) {
          this.next();
        } else {
          this.prev();
        }
        setTimeout(() => { wheelDebounce = false; }, 160);
      }
    }, { passive: true });
  }

  escapeHTML(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

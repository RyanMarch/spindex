// scanner-drawer.js - Barcode scanner slide-over drawer and camera controller
import { cleanBarcode, isValidBarcode, detectBarcode, searchDiscogsBarcode, addReleaseToCollection } from './barcode.js';
import { isDiscogsConnected, discogsState } from './discogs.js';

export class ScannerDrawer {
  constructor({ onRecordAdded, onViewInCrate, onOpenSettings } = {}) {
    this.onRecordAdded = onRecordAdded;
    this.onViewInCrate = onViewInCrate;
    this.onOpenSettings = onOpenSettings;

    this.drawerEl = document.getElementById('scanner-drawer');
    this.closeBtn = document.getElementById('scanner-close-btn');
    this.videoEl = document.getElementById('scanner-video');
    this.canvasEl = document.getElementById('scanner-canvas');
    this.viewfinderWrap = document.getElementById('scanner-viewfinder-wrap');
    this.hintEl = document.getElementById('scanner-hint');
    this.camControls = document.querySelector('.scanner-cam-controls');
    this.torchBtn = document.getElementById('scanner-torch-btn');
    this.flipBtn = document.getElementById('scanner-flip-btn');
    this.camFallbackEl = document.getElementById('scanner-cam-fallback');
    this.camMsgEl = document.getElementById('scanner-cam-msg');
    this.fileInput = document.getElementById('scanner-file-input');
    this.manualForm = document.getElementById('scanner-manual-form');
    this.manualInput = document.getElementById('scanner-manual-input');
    this.resultsEl = document.getElementById('scanner-results');
    this.resultsStatusEl = document.getElementById('scanner-results-status');
    this.resultsListEl = document.getElementById('scanner-results-list');

    this.stream = null;
    this.facingMode = 'environment';
    this.torchOn = false;
    this.scanInterval = null;
    this.isScanning = false;
    this.lastScannedCode = null;
    this.audioCtx = null;

    this.bindEvents();
  }

  bindEvents() {
    if (!this.drawerEl) return;

    this.closeBtn?.addEventListener('click', () => this.close());

    // Light dismiss
    this.drawerEl.addEventListener('click', (e) => {
      if (e.target === this.drawerEl) {
        this.close();
      }
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        e.stopPropagation();
        this.close();
      }
    });

    // Camera controls
    this.torchBtn?.addEventListener('click', () => this.toggleTorch());
    this.flipBtn?.addEventListener('click', () => this.flipCamera());

    // File upload
    this.fileInput?.addEventListener('change', (e) => this.handleFileUpload(e));

    // Page hide / visibility change
    window.addEventListener('pagehide', () => this.stopCamera());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.isOpen()) {
        this.stopCamera();
      } else if (document.visibilityState === 'visible' && this.isOpen() && !this.stream) {
        this.startCamera();
      }
    });

    // Manual form submit
    this.manualForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = this.manualInput?.value?.trim();
      if (val) {
        this.handleBarcodeDetected(val);
      }
    });

    // Add release clicks inside results list
    this.resultsListEl?.addEventListener('click', (e) => {
      const btn = e.target.closest('.scanner-add-btn');
      if (btn) {
        const releaseId = Number(btn.dataset.releaseId);
        const releaseTitle = btn.dataset.releaseTitle || 'Record';
        this.handleAddRelease(releaseId, releaseTitle, btn);
      }
      const viewCrateBtn = e.target.closest('.scanner-view-crate-btn');
      if (viewCrateBtn) {
        const releaseId = Number(viewCrateBtn.dataset.releaseId);
        this.close();
        if (this.onViewInCrate) this.onViewInCrate(releaseId);
      }
      const scanAgainBtn = e.target.closest('.scanner-rescan-btn');
      if (scanAgainBtn) {
        this.resetScannerView();
      }
    });
  }

  isOpen() {
    return Boolean(this.drawerEl?.classList.contains('open'));
  }

  open() {
    if (!this.drawerEl) return;

    this.drawerEl.classList.add('open');
    this.drawerEl.setAttribute('aria-hidden', 'false');

    this.resetScannerView();
  }

  close() {
    if (!this.drawerEl) return;

    this.stopCamera();
    this.drawerEl.classList.remove('open');
    this.drawerEl.setAttribute('aria-hidden', 'true');
  }

  resetScannerView() {
    this.lastScannedCode = null;
    if (this.manualInput) this.manualInput.value = '';
    if (this.resultsEl) this.resultsEl.hidden = true;
    if (this.resultsListEl) this.resultsListEl.innerHTML =  /*html*/ '';
    if (this.viewfinderWrap) this.viewfinderWrap.hidden = false;
    if (this.camFallbackEl) this.camFallbackEl.hidden = true;
    if (this.hintEl) this.hintEl.textContent = 'Align barcode inside the frame';

    if (this.isOpen()) {
      if (!this.stream) {
        this.startCamera();
      } else {
        this.resumeScanning();
      }
    }
  }

  async startCamera() {
    this.cameraSessionId = (this.cameraSessionId || 0) + 1;
    const sessionId = this.cameraSessionId;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.showCameraError('Camera access is not supported by your browser. You can upload an image or type the barcode numbers below.');
      return;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        try { track.stop(); } catch { }
      });
      this.stream = null;
    }
    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.srcObject = null;
    }

    try {
      if (this.camFallbackEl) this.camFallbackEl.hidden = true;
      if (this.viewfinderWrap) this.viewfinderWrap.hidden = false;

      const constraints = {
        video: {
          facingMode: { ideal: this.facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      // If drawer was closed or a newer session started while waiting for permission:
      if (!this.isOpen() || sessionId !== this.cameraSessionId) {
        stream.getTracks().forEach((track) => {
          try { track.stop(); } catch { }
        });
        return;
      }

      this.stream = stream;
      if (this.videoEl) {
        this.videoEl.srcObject = stream;
        try {
          await this.videoEl.play();
        } catch (playErr) {
          if (playErr.name === 'AbortError' || !this.isOpen() || sessionId !== this.cameraSessionId) {
            return;
          }
          throw playErr;
        }
      }

      if (!this.isOpen() || sessionId !== this.cameraSessionId) {
        this.stopCamera();
        return;
      }

      this.checkCameraCapabilities();
      this.resumeScanning();
    } catch (err) {
      if (sessionId !== this.cameraSessionId || !this.isOpen()) {
        return;
      }
      console.warn('Camera start error:', err);
      let msg = 'Could not access the camera. Check camera permissions or enter the barcode numbers below.';
      if (err.name === 'NotAllowedError') {
        msg = 'Camera permission was denied. You can allow camera access in browser settings or enter barcode numbers below.';
      }
      this.showCameraError(msg);
    }
  }

  stopCamera() {
    this.cameraSessionId = (this.cameraSessionId || 0) + 1;
    this.pauseScanning();
    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        try { track.stop(); } catch { }
      });
      this.stream = null;
    }
    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.srcObject = null;
    }
    this.torchOn = false;
    if (this.torchBtn) {
      this.torchBtn.classList.remove('active');
      this.torchBtn.hidden = true;
    }
  }

  async checkCameraCapabilities() {
    if (!this.stream) return;
    const track = this.stream.getVideoTracks()[0];
    if (!track) return;

    // Check torch capability
    const capabilities = track.getCapabilities ? track.getCapabilities() : {};
    if ('torch' in capabilities && this.torchBtn) {
      this.torchBtn.hidden = false;
    } else if (this.torchBtn) {
      this.torchBtn.hidden = true;
    }

    // Check multiple cameras for flip button
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d) => d.kind === 'videoinput');
      if (videoDevices.length > 1 && this.flipBtn) {
        this.flipBtn.hidden = false;
      } else if (this.flipBtn) {
        this.flipBtn.hidden = true;
      }
    } catch {
      if (this.flipBtn) this.flipBtn.hidden = true;
    }
  }

  async toggleTorch() {
    if (!this.stream) return;
    const track = this.stream.getVideoTracks()[0];
    if (!track || !track.applyConstraints) return;

    try {
      this.torchOn = !this.torchOn;
      await track.applyConstraints({
        advanced: [{ torch: this.torchOn }],
      });
      if (this.torchBtn) {
        this.torchBtn.classList.toggle('active', this.torchOn);
      }
    } catch (err) {
      console.warn('Torch toggle failed:', err);
    }
  }

  async flipCamera() {
    this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
    await this.startCamera();
  }

  showCameraError(msg) {
    if (this.viewfinderWrap) this.viewfinderWrap.hidden = true;
    if (this.camFallbackEl) this.camFallbackEl.hidden = false;
    if (this.camMsgEl) this.camMsgEl.textContent = msg;
  }

  resumeScanning() {
    this.pauseScanning();
    this.isScanning = true;
    this.scanInterval = setInterval(() => this.scanFrame(), 150);
  }

  pauseScanning() {
    this.isScanning = false;
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
  }

  async scanFrame() {
    if (!this.isScanning || !this.videoEl || this.videoEl.readyState < 2) return;

    try {
      const code = await detectBarcode(this.videoEl);
      if (code && code !== this.lastScannedCode) {
        this.lastScannedCode = code;
        this.handleBarcodeDetected(code);
      }
    } catch {
      // Detection pass skipped
    }
  }

  async handleFileUpload(e) {
    const file = e.target?.files?.[0];
    if (!file) return;

    this.pauseScanning();
    if (this.hintEl) this.hintEl.textContent = 'Reading barcode from photo...';

    try {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = objectUrl;
      });

      const code = await detectBarcode(img);
      URL.revokeObjectURL(objectUrl);

      if (code) {
        this.handleBarcodeDetected(code);
      } else {
        if (this.hintEl) this.hintEl.textContent = 'No barcode detected in photo. Try another or enter digits below.';
        this.resumeScanning();
      }
    } catch (err) {
      console.warn('Image barcode read error:', err);
      if (this.hintEl) this.hintEl.textContent = 'Could not read image. Try entering digits below.';
      this.resumeScanning();
    } finally {
      if (this.fileInput) this.fileInput.value = '';
    }
  }

  playSuccessChime() {
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([40, 60, 40]);
      }
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.audioCtx) this.audioCtx = new AudioCtx();
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1320, now + 0.08);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.25);
    } catch {
      // Audio feedback optional
    }
  }

  async handleBarcodeDetected(rawCode) {
    const code = cleanBarcode(rawCode);
    if (!code) return;

    this.pauseScanning();
    this.playSuccessChime();

    if (this.manualInput) this.manualInput.value = code;
    if (this.hintEl) this.hintEl.textContent = `Barcode: ${code}`;
    if (this.viewfinderWrap) this.viewfinderWrap.hidden = true;
    if (this.resultsEl) this.resultsEl.hidden = false;

    if (this.resultsStatusEl) {
      this.resultsStatusEl.innerHTML =  /*html*/ `
        <div class="scanner-loading-row">
          <span class="scanner-spinner"></span>
          <span>Searching Discogs for <strong>${code}</strong>...</span>
        </div>
      `;
    }
    if (this.resultsListEl) this.resultsListEl.innerHTML =  /*html*/ '';

    const connected = isDiscogsConnected();
    const state = discogsState();

    try {
      const results = await searchDiscogsBarcode(code);
      this.renderResults(results, code, connected, state.username);
    } catch (err) {
      console.error(err);
      if (this.resultsStatusEl) {
        this.resultsStatusEl.innerHTML =  /*html*/ `
          <div class="scanner-error-card">
            <p class="scanner-error-text">Failed to query Discogs: ${err.message}</p>
            <button type="button" class="btn btn-secondary btn-sm scanner-rescan-btn">Try again</button>
          </div>
        `;
      }
    }
  }

  renderResults(results, barcode, connected, username) {
    if (!this.resultsStatusEl || !this.resultsListEl) return;

    if (!connected) {
      this.resultsStatusEl.innerHTML =  /*html*/ `
        <div class="scanner-notice-bar">
          <p>You can search barcodes freely, but you must <strong>connect your Discogs account</strong> to add albums to your collection.</p>
        </div>
      `;
    } else {
      this.resultsStatusEl.innerHTML =  /*html*/ `
        <div class="scanner-results-summary">
          <span>Found ${results.length} ${results.length === 1 ? 'match' : 'matches'} for <strong>${barcode}</strong></span>
          <button type="button" class="text-btn scanner-rescan-btn">Scan another</button>
        </div>
      `;
    }

    if (results.length === 0) {
      this.resultsListEl.innerHTML =  /*html*/ `
        <div class="scanner-empty-results">
          <p>No matching releases found on Discogs for barcode <code>${barcode}</code>.</p>
          <p class="scanner-hint-text">Some pressings have country-specific variants or slightly different catalog numbers.</p>
          <button type="button" class="btn btn-secondary scanner-rescan-btn" style="margin-top: 1rem;">Scan another barcode</button>
        </div>
      `;
      return;
    }

    const cardsHtml = results.map((item) => {
      const thumb = item.thumb || '/assets/album-placeholder.svg';
      const yearStr = item.year ? ` • ${item.year}` : '';
      const countryStr = item.country ? ` • ${item.country}` : '';
      const catnoStr = item.catno ? ` • ${item.catno}` : '';
      const labelStr = item.label || '';
      const formatStr = item.format || 'Vinyl';

      const inCollectionBadge = item.inCollection
        ? /*html*/ `<span class="scanner-badge-in-crate">In collection</span>`
        : '';

      const actionButton = connected
        ? /*html*/ `
          <button type="button"
            class="btn btn-primary btn-sm scanner-add-btn"
            data-release-id="${item.id}"
            data-release-title="${this.escapeAttr(item.title)}">
            Add to Crate
          </button>
        `
        : /*html*/ `
          <button type="button"
            class="btn btn-secondary btn-sm"
            onclick="document.getElementById('scanner-close-btn').click(); document.getElementById('settings-toggle-btn').click();">
            Connect Discogs
          </button>
        `;

      return /*html*/ `
        <article class="scanner-result-item" data-release-id="${item.id}">
          <img class="scanner-result-thumb" src="${thumb}" alt="${this.escapeAttr(item.title)}" loading="lazy" />
          <div class="scanner-result-meta">
            <h4 class="scanner-result-title">${this.escapeHTML(item.title)}</h4>
            <p class="scanner-result-details">
              <span>${this.escapeHTML(formatStr)}${yearStr}${countryStr}</span>
            </p>
            ${labelStr || catnoStr ? /*html*/ `<p class="scanner-result-label">${this.escapeHTML(labelStr)}${catnoStr}</p>` : ''}
            <div class="scanner-result-actions">
              ${inCollectionBadge}
              ${actionButton}
            </div>
          </div>
        </article>
      `;
    }).join('');

    this.resultsListEl.innerHTML =  /*html*/ cardsHtml;
  }

  async handleAddRelease(releaseId, releaseTitle, buttonEl) {
    const state = discogsState();
    if (!state.username) {
      if (this.onOpenSettings) this.onOpenSettings();
      return;
    }

    buttonEl.disabled = true;
    buttonEl.textContent = 'Adding...';

    try {
      await addReleaseToCollection(state.username, releaseId);
      buttonEl.textContent = 'Added ✓';
      buttonEl.classList.add('btn-success');
      buttonEl.disabled = true;

      // Add View in Crate button
      if (!buttonEl.parentElement?.querySelector('.scanner-view-crate-btn')) {
        const viewBtn = document.createElement('button');
        viewBtn.type = 'button';
        viewBtn.className = 'btn btn-secondary btn-sm scanner-view-crate-btn';
        viewBtn.textContent = 'View in Crate';
        viewBtn.dataset.releaseId = String(releaseId);
        buttonEl.parentElement?.appendChild(viewBtn);
      }

      if (this.onRecordAdded) {
        this.onRecordAdded({
          discogsId: releaseId,
          title: releaseTitle,
        });
      }
    } catch (err) {
      console.error(err);
      buttonEl.disabled = false;
      buttonEl.textContent = 'Retry';
      alert(`Could not add release to Discogs: ${err.message}`);
    }
  }

  escapeHTML(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  escapeAttr(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

// notes.js - Inline Gatefold (album inspector) controller
import { updateRecord, getRecord } from './db.js';
import { groupTracksBySide, calculateTotalDuration, getRecordTags } from './sync.js';

export class GatefoldController {
  constructor() {
    this.activeRecord = null;

    // Gatefold elements
    this.workspace = document.getElementById('gatefold-workspace');
    this.backBtn = document.getElementById('gatefold-back-btn');
    this.jacketArt = document.getElementById('gatefold-jacket-art');
    this.labelArt = document.getElementById('gatefold-label-art');
    this.vinylDisc = document.getElementById('gatefold-vinyl-disc');
    this.titleEl = document.getElementById('gatefold-title');
    this.artistEl = document.getElementById('gatefold-artist');
    this.yearEl = document.getElementById('gatefold-year');
    this.provenanceEl = document.getElementById('gatefold-provenance');
    this.tracklistEl = document.getElementById('gatefold-tracklist');
    this.wikiEl = document.getElementById('gatefold-wiki');


    this.bindEvents();
  }

  bindEvents() {
    if (this.backBtn) {
      this.backBtn.addEventListener('click', () => this.closeGatefold());
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
      }
    });
  }

  async openGatefold(record) {
    const freshRecord = (await getRecord(record.id)) || record;

    if (freshRecord.context && (!freshRecord.releaseDate || freshRecord.year === freshRecord.pressingYear)) {
      await this.resolveStructuredReleaseDate(freshRecord, freshRecord.context?.wikiTitle || null);
    }

    this.activeRecord = freshRecord;
    this.renderGatefoldBasic(freshRecord);

    if (this.workspace) {
      this.workspace.classList.add('open');
      document.body.classList.add('sleeve-open');
      this.workspace.setAttribute('aria-hidden', 'false');
    }

    // Trigger vinyl disc slide-out slightly after open
    setTimeout(() => {
      if (this.vinylDisc) this.vinylDisc.classList.add('ejected');
    }, 180);

    if (!freshRecord.context) {
      await this.fetchLinerNotes(freshRecord);
    } else {
      this.renderLinerNotes(freshRecord.context);
    }
  }

  closeGatefold() {
    if (this.vinylDisc) this.vinylDisc.classList.remove('ejected');

    if (this.workspace) {
      this.workspace.classList.remove('open');
      document.body.classList.remove('sleeve-open');
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
    const isDivergentEdition = Boolean(record.year && record.masterYear && record.year !== record.masterYear);
    const originalYear = isDivergentEdition
      ? record.year
      : (record.masterYear || record.originalYear || record.year);
    const pressingYear = record.pressingYear || record.year;

    // Format release date if available (e.g. "October 14, 1977" or "1977")
    let releaseDateStr = '';
    if (record.releaseDate) {
      try {
        const d = new Date(record.releaseDate);
        if (!isNaN(d.getTime())) {
          releaseDateStr = d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });
        }
      } catch {
        releaseDateStr = '';
      }
    }
    const yearDisplay = releaseDateStr || (originalYear ? String(originalYear) : '');

    const durStr = calculateTotalDuration(record.tracklist) || '';
    const genresList = getRecordTags(record).slice(0, 2).join(', ');

    const mainLineParts = [yearDisplay, durStr, genresList].filter(Boolean);

    if (this.yearEl) {
      this.yearEl.textContent = mainLineParts.join(' · ');
    }

    if (this.provenanceEl) {
      if (pressingYear && originalYear && pressingYear !== originalYear) {
        this.provenanceEl.textContent = `Reissue pressed in ${pressingYear}`;
        this.provenanceEl.style.display = 'block';
      } else if (record.masterYear && record.year && record.year !== record.masterYear) {
        this.provenanceEl.textContent = `Original album released in ${record.masterYear}`;
        this.provenanceEl.style.display = 'block';
      } else {
        this.provenanceEl.textContent = '';
        this.provenanceEl.style.display = 'none';
      }
    }

    if (this.tracklistEl) {
      this.tracklistEl.innerHTML =  /*html*/ this.renderTracklistHTML(record.tracklist || []);
    }

    if (this.wikiEl) {
      this.wikiEl.innerHTML =  /*html*/ '<p class="gatefold-loading">Reading from archives...</p>';
    }
  }

  renderLinerNotes(context) {
    if (this.wikiEl) {
      this.wikiEl.innerHTML =  /*html*/ context.wikiExtract || '<p class="gatefold-empty">No additional sleeve notes found in the archives.</p>';
    }
  }

  async fetchLinerNotes(record) {
    try {
      // First try searching Wikipedia to find the exact article title
      let titleToFetch = null;
      const queries = [
        `${record.artist || ''} ${record.title || ''} album`.trim(),
        `${record.artist || ''} ${record.title || ''}`.trim(),
        record.title || '',
        record.artist || ''
      ].filter(Boolean);

      for (const query of queries) {
        try {
          const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&utf8=&format=json&origin=*`;
          const sRes = await fetch(searchUrl);
          if (sRes.ok) {
            const sData = await sRes.json();
            const topHit = sData?.query?.search?.[0]?.title;
            if (topHit) {
              titleToFetch = topHit;
              break;
            }
          }
        } catch {
          // Continue to next query candidate
        }
      }

      if (!titleToFetch) {
        titleToFetch = `${record.artist || ''} ${record.title || ''}`.trim();
      }

      const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titleToFetch)}`);
      if (!res.ok) throw new Error('No summary found');

      const data = await res.json();
      const context = {
        wikiExtract: data.extract_html || `<p>${data.extract || ''}</p>`,
        wikiDescription: data.description || '',
        wikiUrl: data.content_urls?.desktop?.page || '',
        wikiImage: data.originalimage?.source || data.thumbnail?.source || null,
        wikiTitle: titleToFetch,
      };

      await updateRecord(record.id, { context });
      record.context = context;

      await this.resolveStructuredReleaseDate(record, titleToFetch);

      if (this.activeRecord && this.activeRecord.id === record.id) {
        this.activeRecord.context = context;
        this.renderGatefoldBasic(this.activeRecord);
        this.renderLinerNotes(context);
      }
    } catch {
      if (this.wikiEl) {
        this.wikiEl.innerHTML =  /*html*/ '<p class="gatefold-empty">No additional sleeve notes found in the archives.</p>';
      }
    }
  }

  async resolveStructuredReleaseDate(record, wikiTitle) {
    let resolvedDate = null;
    let resolvedYear = null;

    // 1. Check Wikipedia wikitext infobox `| released =`
    if (wikiTitle) {
      try {
        const parseUrl = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(wikiTitle)}&prop=wikitext&format=json&origin=*`;
        const parseRes = await fetch(parseUrl);
        if (parseRes.ok) {
          const parseData = await parseRes.json();
          const wikitext = parseData?.parse?.wikitext?.['*'] || '';
          const m = wikitext.match(/\|\s*released\s*=\s*(.+?)(?=\n\s*\||\n\s*\}\}|$)/is);
          if (m) {
            let raw = m[1].trim();
            raw = raw.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '').replace(/<ref\b[^>]*\/>/gi, '').trim();

            const startDateMatch = raw.match(/\{\{Start date(?: and age)?\|(\d{4})\|(\d{1,2})\|(\d{1,2})/i);
            if (startDateMatch) {
              const y = parseInt(startDateMatch[1], 10);
              const mo = startDateMatch[2].padStart(2, '0');
              const d = startDateMatch[3].padStart(2, '0');
              resolvedYear = y;
              resolvedDate = `${y}-${mo}-${d}T00:00:00.000Z`;
            } else {
              const cleanStr = raw.replace(/<[^>]+>/g, '').replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1').trim();
              const parsed = new Date(cleanStr);
              if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 1900 && parsed.getFullYear() <= 2030) {
                resolvedYear = parsed.getFullYear();
                resolvedDate = parsed.toISOString();
              } else {
                const yearMatch = cleanStr.match(/\b(19\d{2}|20\d{2})\b/);
                if (yearMatch) {
                  resolvedYear = parseInt(yearMatch[1], 10);
                }
              }
            }
          }
        }
      } catch {
        // Fall through to MusicBrainz
      }
    }

    // 2. Structured fallback: MusicBrainz Release Group (open, structured music catalog)
    if (!resolvedYear && record.artist && record.title) {
      try {
        const cleanTitle = record.title.replace(/\([^)]*\)/g, '').trim();
        const mbUrl = `https://musicbrainz.org/ws/2/release-group?query=artist:${encodeURIComponent(record.artist)}+AND+releasegroup:${encodeURIComponent(cleanTitle)}&fmt=json`;
        const mbRes = await fetch(mbUrl);
        if (mbRes.ok) {
          const mbData = await mbRes.json();
          const groups = mbData?.['release-groups'] || [];
          if (groups.length > 0 && groups[0]['first-release-date']) {
            const firstDateStr = groups[0]['first-release-date'];
            const yearMatch = firstDateStr.match(/^(\d{4})/);
            if (yearMatch) {
              resolvedYear = parseInt(yearMatch[1], 10);
              const parsed = new Date(firstDateStr);
              if (!isNaN(parsed.getTime())) {
                resolvedDate = parsed.toISOString();
              }
            }
          }
        }
      } catch {
        // Ignore MusicBrainz failure
      }
    }

    // 3. Fallback: Parse description year (e.g. "2003 studio album by AFI")
    if (!resolvedYear && record.context?.wikiDescription) {
      const descMatch = record.context.wikiDescription.match(/\b(19\d{2}|20\d{2})\b/);
      if (descMatch) {
        resolvedYear = parseInt(descMatch[1], 10);
      }
    }

    if (resolvedYear) {
      const updates = {
        originalYear: resolvedYear,
        year: resolvedYear,
      };
      if (resolvedDate) {
        updates.releaseDate = resolvedDate;
      }

      await updateRecord(record.id, updates);
      Object.assign(record, updates);
      if (this.activeRecord && this.activeRecord.id === record.id) {
        this.renderGatefoldBasic(this.activeRecord);
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

  escapeHTML(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

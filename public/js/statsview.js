// statsview.js - draws collection stats (from stats.js) into the Stats panel. Bars are plain CSS and the growth line is
// a small inline SVG, so there are no chart libraries to load.
import { vinylFill } from './vinyl.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = (n) => Number(n).toLocaleString('en-US');

function bars(rows, { max = Math.max(...rows.map((r) => r.count), 1) } = {}) {
  return `<div class="stat-bars">${rows.map((r) => `
    <div class="stat-row">
      <span class="stat-label">${esc(r.name)}</span>
      <span class="stat-bar"><i style="width:${Math.max(3, Math.round((r.count / max) * 100))}%"></i></span>
      <span class="stat-count">${number(r.count)}</span>
    </div>`).join('')}</div>`;
}

const section = (title, body, note = '') => `<section class="stat-section"><h4>${esc(title)}</h4>${body}${note ? `<p class="stat-note">${esc(note)}</p>` : ''}</section>`;

const monthLabel = (key) => {
  const [year, month] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};

// Cumulative line: the shape of how the collection grew
function growthChart(growth) {
  if (growth.length < 2) return '';
  const w = 300;
  const h = 84;
  const top = growth[growth.length - 1].total;
  const x = (i) => (i / (growth.length - 1)) * w;
  const y = (total) => h - (total / top) * (h - 6) - 2;
  const line = growth.map((g, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(g.total).toFixed(1)}`).join(' ');
  const svg = `<svg class="stat-growth" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Records owned over time, ${number(top)} in total">
    <path d="${line} L${w},${h} L0,${h} Z" class="stat-growth-fill"></path><path d="${line}" class="stat-growth-line"></path></svg>`;
  return `${svg}<div class="stat-axis"><span>${esc(monthLabel(growth[0].month))}</span><span>${number(top)} records</span><span>${esc(monthLabel(growth[growth.length - 1].month))}</span></div>`;
}

export function statsHTML(stats) {
  if (stats.total === 0) return '<p class="stat-note">Nothing in the crate yet.</p>';

  const hours = stats.runtimeSeconds / 3600;
  const span = stats.oldest && stats.newest ? `${stats.oldest.year} to ${stats.newest.year}` : '';
  const tiles = [
    [number(stats.total), stats.total === 1 ? 'record' : 'records'],
    [number(stats.artistCount), stats.artistCount === 1 ? 'artist' : 'artists'],
    hours >= 1 ? [number(Math.round(hours)), 'hours of music'] : null,
    span ? [span, 'release years'] : null,
  ].filter(Boolean);

  const parts = [`<div class="stat-tiles">${tiles.map(([value, label]) => `<div class="stat-tile"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join('')}</div>`];
  parts.push('<div id="stat-value"></div>');

  if (stats.decades.length) parts.push(section('Release year', bars(stats.decades), stats.undated ? `${stats.undated} without a year yet.` : ''));
  if (stats.genres.length) parts.push(section('Genres', bars(stats.genres)));

  if (stats.colors.length) {
    const chips = stats.colors.map((c) => `<li><span class="stat-disc" style="background:${esc(vinylFill(c.sample))}"></span><span>${esc(c.name)}</span><b>${number(c.count)}</b></li>`).join('');
    const partial = stats.colorCoverage.known < stats.colorCoverage.total;
    parts.push(section('Vinyl', `<ul class="stat-colors">${chips}</ul>`, partial ? `Based on ${number(stats.colorCoverage.known)} of ${number(stats.colorCoverage.total)} records so far. The rest fill in as their details load.` : ''));
  }

  if (stats.topArtists.length && stats.topArtists[0].count > 1) parts.push(section('Most collected artists', bars(stats.topArtists.filter((a) => a.count > 1))));
  const growth = growthChart(stats.growth);
  if (growth) parts.push(section('Growth', growth));

  return parts.join('');
}

// The live value from Discogs: min, median and max. `state` is 'loading', 'error', or the response.
export function valueHTML(state) {
  if (state === 'loading') return section('Collection value', '<p class="stat-note">Asking Discogs…</p>');
  if (!state || state === 'error') return section('Collection value', '<p class="stat-note">Couldn\'t reach Discogs for the value just now.</p>');
  const cells = [['Low', state.minimum], ['Median', state.median], ['High', state.maximum]];
  return section('Collection value', `<div class="stat-tiles stat-value">${cells.map(([label, v]) => `<div class="stat-tile"><strong>${esc(v)}</strong><span>${esc(label)}</span></div>`).join('')}</div>`, "Live from Discogs each time you open this. It isn't saved.");
}

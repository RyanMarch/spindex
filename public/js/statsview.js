// statsview.js - draws collection stats (from stats.js) into the Stats panel. It is laid out like the printed page inside
// a sleeve: a sentence up top, an index with dotted leaders, a row of spines, and the real covers. No chart libraries.
import { vinylFill } from './vinyl.js';
import { smallArtUrl } from './browse.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = (n) => Number(n).toLocaleString('en-US');

const section = (title, body, note = '') => `<section class="st-section"><h4>${esc(title)}</h4>${body}${note ? `<p class="st-note">${esc(note)}</p>` : ''}</section>`;

// One line of an index: the name, a dotted leader, the number
const indexRow = (name, count, lead = '') => `<li class="st-row">${lead}<span class="st-name">${esc(name)}</span><span class="st-dots" aria-hidden="true"></span><b>${number(count)}</b></li>`;

const monthLabel = (key) => {
  const [year, month] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export function playTime(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

// A row of spines per decade, one per record, as if the collection were standing on a shelf
export function spinesHTML(decades) {
  const most = Math.max(...decades.map((d) => d.count), 1);
  const per = Math.max(1, Math.ceil(most / 36)); // a very large collection: each spine stands for a few records
  const rows = decades.map((d) => {
    const shown = Math.ceil(d.count / per);
    const spines = Array.from({ length: shown }, (_, i) => `<i style="height:${20 + (((d.years[i * per] || d.decade) * 7) % 5) * 3}px"></i>`).join('');
    return `<li class="st-shelf-row"><span class="st-name">${esc(d.name)}</span><span class="st-spines">${spines}</span><b>${number(d.count)}</b></li>`;
  }).join('');
  return `<ul class="st-shelf">${rows}</ul>${per > 1 ? `<p class="st-note">Each spine is up to ${per} records.</p>` : ''}`;
}

const cover = (record, cls = 'st-cover') => `<img class="${cls}" src="${esc(smallArtUrl(record, 120))}" alt="" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">`;

function standout(kicker, record, detail) {
  return `<li class="st-standout">${cover(record)}<span class="st-standout-text"><em>${esc(kicker)}</em><strong>${esc(record.title)}</strong><span>${esc(record.artist)} · ${esc(detail)}</span></span></li>`;
}

function renderStandoutItem(item) {
  if (item.type === 'artist-fan') {
    const stack = (item.records || []).map((r, i) => `<span style="--i:${i}">${cover(r, 'st-cover')}</span>`).join('');
    return `<li class="st-standout st-artist"><span class="st-fan">${stack}</span><span class="st-standout-text"><em>${esc(item.kicker)}</em><strong>${esc(item.artist)}</strong><span>${number(item.count)} records</span></span></li>`;
  }
  if (item.type === 'record') {
    return `<li class="st-standout">${cover(item.record)}<span class="st-standout-text"><em>${esc(item.kicker)}</em><strong>${esc(item.record.title)}</strong><span>${esc(item.record.artist)} · ${esc(item.detail)}</span></span></li>`;
  }
  // Text facts with an icon badge aligned in the 60x60 cover slot
  return `<li class="st-standout"><span class="st-standout-icon">${renderStatIcon(item.icon)}</span><span class="st-standout-text"><em>${esc(item.kicker)}</em><strong>${esc(item.title)}</strong><span>${esc(item.detail)}</span></span></li>`;
}

function renderStatIcon(icon) {
  switch (icon) {
    case 'calendar':
      return `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`;
    case 'clock':
      return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
    case 'scale':
      return `<svg viewBox="0 0 24 24"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"></path><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"></path><path d="M7 21h10"></path><path d="M12 3v18"></path><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"></path></svg>`;
    case 'star':
      return `<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
    case 'sparkles':
      return `<svg viewBox="0 0 24 24"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path></svg>`;
    case 'disc':
    default:
      return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>`;
  }
}

function standouts(stats) {
  const pool = stats.standoutsPool || [];
  if (pool.length === 0) return '';
  const topArtistItem = pool.find((item) => item.id === 'top-artist');
  const others = pool.filter((item) => item.id !== 'top-artist');
  const chosen = topArtistItem
    ? [topArtistItem, ...others.sort(() => Math.random() - 0.5).slice(0, 3)]
    : others.sort(() => Math.random() - 0.5).slice(0, 4);
  return chosen.map(renderStandoutItem).join('');
}

// Cumulative line: the shape of how the collection grew
function growthChart(growth) {
  if (growth.length < 2) return '';
  const w = 300;
  const h = 72;
  const top = growth[growth.length - 1].total;
  const x = (i) => (i / (growth.length - 1)) * w;
  const y = (total) => h - (total / top) * (h - 6) - 2;
  const line = growth.map((g, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(g.total).toFixed(1)}`).join(' ');
  const svg = `<svg class="st-growth" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Records owned over time, ${number(top)} in total"><path d="${line}" class="st-growth-line"></path></svg>`;
  return `${svg}<div class="st-axis"><span>${esc(monthLabel(growth[0].month))}</span><span>${number(top)} records</span><span>${esc(monthLabel(growth[growth.length - 1].month))}</span></div>`;
}

export function statsHTML(stats) {
  if (stats.total === 0) return '<p class="st-note">Nothing in the crate yet.</p>';

  const hours = stats.runtimeSeconds / 3600;
  const span = stats.oldest && stats.newest && stats.oldest.year !== stats.newest.year ? ` released between <b>${stats.oldest.year}</b> and <b>${stats.newest.year}</b>` : '';
  const lede = `<p class="st-lede"><b>${number(stats.total)}</b> ${stats.total === 1 ? 'record' : 'records'} by <b>${number(stats.artistCount)}</b> ${stats.artistCount === 1 ? 'artist' : 'artists'}${hours >= 1 ? `, about <b>${number(Math.round(hours))} hours</b> of music` : ''}${span ? `,${span}` : ''}.</p>`;

  const parts = [lede, '<div id="stat-value"></div>'];
  if (stats.decades.length) parts.push(section('On the shelf', spinesHTML(stats.decades), stats.undated ? `${stats.undated} without a year.` : ''));
  const stand = standouts(stats);
  if (stand) parts.push(section('Standouts', `<ul class="st-standouts">${stand}</ul>`));

  if (stats.genres.length) parts.push(section('Filed under', `<ul class="st-index">${stats.genres.map((g) => indexRow(g.name, g.count)).join('')}</ul>`));

  if (stats.colors.length) {
    const rows = stats.colors.map((c) => indexRow(c.name, c.count, `<span class="st-disc" style="background:${esc(vinylFill(c.sample))}"></span>`)).join('');
    const partial = stats.colorCoverage.known < stats.colorCoverage.total;
    parts.push(section('Pressings', `<ul class="st-index">${rows}</ul>`, partial ? `Based on ${number(stats.colorCoverage.known)} of ${number(stats.colorCoverage.total)} records so far. The rest fill in as their details load.` : ''));
  }

  const growth = growthChart(stats.growth);
  if (growth) parts.push(section('Added over time', growth));
  return parts.join('');
}

// "$1,552.55" -> "$1,552"; a number to place the median on the range
const wholeMoney = (text) => String(text ?? '').replace(/\.\d+$/, '');
const amount = (text) => parseFloat(String(text ?? '').replace(/[^0-9.]/g, ''));

// The live value from Discogs, as a sentence. `state` is 'loading', 'error', or the response ({ minimum, median, maximum }).
export function valueHTML(state) {
  if (state === 'loading') return '<p class="st-value-line st-quiet">Asking Discogs what it\'s worth…</p>';
  if (!state || state === 'error') return '<p class="st-value-line st-quiet">Couldn\'t reach Discogs for the value just now.</p>';
  const low = amount(state.minimum);
  const mid = amount(state.median);
  const high = amount(state.maximum);
  const at = high > low && mid >= low ? Math.min(100, Math.max(0, ((mid - low) / (high - low)) * 100)) : null;
  const range = at === null ? '' : `<div class="st-range" role="img" aria-label="The median sits ${Math.round(at)}% of the way from low to high"><i style="left:${at.toFixed(1)}%"></i></div>`;
  return `<div class="st-value"><p class="st-value-line">Worth about <b>${esc(wholeMoney(state.median))}</b>, somewhere between ${esc(wholeMoney(state.minimum))} and ${esc(wholeMoney(state.maximum))}.</p>${range}<p class="st-note">Live from Discogs each time you open this. It isn't saved.</p></div>`;
}

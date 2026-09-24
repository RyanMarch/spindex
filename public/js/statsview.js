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

function standouts(stats) {
  const items = [];
  if (stats.oldest) items.push(standout('Oldest', stats.oldest.record, stats.oldest.year));
  if (stats.newest && stats.newest.record !== stats.oldest?.record) items.push(standout('Newest', stats.newest.record, stats.newest.year));
  if (stats.longest) items.push(standout('Longest', stats.longest.record, playTime(stats.longest.seconds)));
  const out = items.join('');
  if (!stats.topArtist) return out;
  const stack = stats.topArtist.records.map((r, i) => `<span style="--i:${i}">${cover(r, 'st-cover')}</span>`).join('');
  return `${out}<li class="st-standout st-artist"><span class="st-fan">${stack}</span><span class="st-standout-text"><em>Most collected</em><strong>${esc(stats.topArtist.name)}</strong><span>${number(stats.topArtist.count)} records</span></span></li>`;
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

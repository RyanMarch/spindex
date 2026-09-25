// filters.js - narrowing the crate by what a pressing is: its decade, size, colour, number of discs and speed. Pure
// functions over the records already in this browser. Within one group a record may match any chosen option; across
// groups it must match every group that has a choice.
import { sortYear } from './years.js';
import { parseVinyl, discCount, unusualSpeed, formatsOf } from './vinyl.js';
import { colorGroup } from './stats.js';

export const GROUPS = [
  { key: 'decades', title: 'Decade', needsDetails: false },
  { key: 'sizes', title: 'Size', needsDetails: true },
  { key: 'pressings', title: 'Pressing', needsDetails: true },
  { key: 'discs', title: 'Discs', needsDetails: true },
  { key: 'speeds', title: 'Speed', needsDetails: true },
];

export const emptySelection = () => ({ decades: [], sizes: [], pressings: [], discs: [], speeds: [] });

const hasDetails = (r) => Boolean(formatsOf(r).length);
const vinylOf = (r) => formatsOf(r).find((f) => /vinyl|^lp$|^12"|^10"|^7"/i.test(f?.name || '')) || null;

const VALUE = {
  decades: (r) => {
    const year = sortYear(r);
    return year ? `${Math.floor(year / 10) * 10}s` : null;
  },
  sizes: (r) => {
    const vinyl = vinylOf(r);
    if (!vinyl) return null;
    const size = (vinyl.descriptions || []).find((d) => /^(7|10|12)"$/.test(d));
    return size || ((vinyl.descriptions || []).includes('LP') ? '12"' : null); // an LP is a twelve-inch
  },
  pressings: (r) => (hasDetails(r) ? colorGroup(parseVinyl(formatsOf(r))) : null),
  discs: (r) => {
    if (!vinylOf(r)) return null;
    return discCount(formatsOf(r)) >= 2 ? 'multi' : 'single';
  },
  speeds: (r) => (vinylOf(r) ? unusualSpeed(formatsOf(r)) || null : null),
};

const LABEL = { multi: 'Two or more discs', single: 'One disc' };
const labelFor = (group, key) => (group === 'discs' ? LABEL[key] : key);

const ORDER = {
  decades: (a, b) => parseInt(a.key, 10) - parseInt(b.key, 10),
  sizes: (a, b) => parseInt(b.key, 10) - parseInt(a.key, 10),
  discs: (a) => (a.key === 'single' ? -1 : 1),
  speeds: (a, b) => parseInt(a.key, 10) - parseInt(b.key, 10),
  pressings: (a, b) => b.count - a.count || a.key.localeCompare(b.key),
};

// The options that actually exist in this collection, with how many records each would show
export function facetsFor(records) {
  const out = {};
  for (const { key } of GROUPS) {
    const counts = new Map();
    for (const r of records) {
      const v = VALUE[key](r);
      if (v) counts.set(v, (counts.get(v) || 0) + 1);
    }
    out[key] = [...counts].map(([k, count]) => ({ key: k, label: labelFor(key, k), count })).sort(ORDER[key]);
  }
  return { ...out, detailed: records.filter(hasDetails).length, total: records.length };
}

export function matchesFilters(record, selection) {
  for (const { key } of GROUPS) {
    const chosen = selection?.[key];
    if (!chosen?.length) continue;
    const v = VALUE[key](record);
    if (!v || !chosen.includes(v)) return false; // no details yet: can't say, so it isn't shown
  }
  return true;
}

export const activeCount = (selection) => GROUPS.reduce((sum, { key }) => sum + (selection?.[key]?.length || 0), 0);

export function toggleOption(selection, group, key) {
  const next = { ...selection, [group]: [...(selection[group] || [])] };
  const at = next[group].indexOf(key);
  if (at === -1) next[group].push(key);
  else next[group].splice(at, 1);
  return next;
}

// A sentence for the empty state: what is being asked for
export function describeSelection(selection) {
  const parts = [];
  for (const { key } of GROUPS) for (const v of selection?.[key] || []) parts.push(labelFor(key, v));
  return parts.join(', ');
}

// years.js - which year a record files under. The rule: a record sorts by the year the album first came out (the
// Discogs master's year), not the year of the pressing in the crate, so a 2023 vinyl issue of a 1999 album files
// under 1999. Special editions ("Deluxe", "25th Anniversary") keep their own pressing year.

export const isEditionTitle = (title) =>
  /\b2\.0\b/i.test(title)
  || /\b\d+(?:th)?\s+anniversary\b/i.test(title)
  || /\bdeluxe\b/i.test(title)
  || /\bexpanded\b/i.test(title);

// The year used for sorting and shown on the crate
export function sortYear(record) {
  if (record.year && record.masterYear && record.year !== record.masterYear) return record.year;
  return record.masterYear || record.originalYear || record.year || 0;
}

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Given a record and its Discogs master, the fields to save (the master's title too: it is what other services usually call
// the album). A master with no year is marked checked, so it is not asked for again.
export function masterYearUpdates(record, master) {
  const masterYear = Number(master?.year) || 0;
  const masterTitle = String(master?.title || '').trim();
  if (!masterYear) return { masterChecked: true, ...(masterTitle && { masterTitle }) };

  const relTitle = clean(record.title);
  const masTitle = clean(master.title);
  const diverges = relTitle !== masTitle && (isEditionTitle(record.title) || (relTitle.startsWith(masTitle) && relTitle.length >= masTitle.length + 2));
  const year = diverges && record.pressingYear ? record.pressingYear : masterYear;

  return { masterYear, originalYear: year, year, masterChecked: true, ...(masterTitle && { masterTitle }) };
}

// A year from iTunes is only a fallback for records with no Discogs master, and only if it is earlier than what we
// already have: an iTunes date is often a remaster's, and must never push an album later.
export function itunesYearUpdates(record, itunesYear) {
  if (!itunesYear || record.masterId || record.masterYear) return {};
  const current = record.originalYear || record.year || record.pressingYear || 0;
  if (current && itunesYear >= current) return {};
  return { originalYear: itunesYear, year: itunesYear };
}

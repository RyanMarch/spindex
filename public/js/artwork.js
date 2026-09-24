// artwork.js - which cover a record shows, and the one control that lets a person change their mind.
//
// A record's cover comes from Discogs (the image for the pressing in the crate) or from a cleaner source (Deezer, iTunes)
// that was checked to be the same picture. When a cleaner cover looked like a different one, it is kept as `artCandidate`
// rather than used. Choosing by hand pins the record (`artworkLocked`) so background passes leave it alone.

const SOURCE_NAMES = { deezer: 'Deezer', itunes: 'iTunes', discogs: 'Discogs' };
const CLEANER = ['itunes', 'deezer'];

export const sourceName = (source) => SOURCE_NAMES[source] || 'another source';

// What the control should say and do for this record, or null when there is nothing to choose between
export function artControl(record) {
  const source = record.artwork?.source;
  const original = record.discogsArtwork?.highRes || record.discogsArtwork?.thumbnail;
  const candidate = record.artCandidate;

  if (CLEANER.includes(source) && original) {
    const why = record.artworkLocked ? 'you chose' : 'matched to the Discogs image';
    return { action: 'discogs', note: `Showing cleaner artwork from ${sourceName(source)}, ${why}.`, label: 'Not the right cover? Use the Discogs image' };
  }
  if (source === 'discogs' && candidate) {
    return {
      action: 'candidate',
      note: `Showing the Discogs image for your pressing. ${sourceName(candidate.source)} has a cover that looks different, so it wasn't swapped in.`,
      label: `Use the ${sourceName(candidate.source)} cover instead`,
    };
  }
  if (source === 'discogs' && record.artworkLocked) {
    return { action: 'retry', note: 'Showing the Discogs image you chose.', label: 'Look for cleaner artwork again' };
  }
  return null;
}

// The fields to save when the control is used. Choosing pins the record; "retry" un-pins it and lets the passes look again.
export function artChoiceUpdates(record, action) {
  if (action === 'discogs') {
    if (!(record.discogsArtwork?.highRes || record.discogsArtwork?.thumbnail)) return null;
    return { artwork: record.discogsArtwork, artCandidate: record.artwork, artworkLocked: true };
  }
  if (action === 'candidate') {
    if (!record.artCandidate) return null;
    return { artwork: record.artCandidate, artCandidate: null, artworkLocked: true };
  }
  if (action === 'retry') {
    return { artworkLocked: false, artCandidate: null, deezerChecked: false, fallbackArtChecked: false, artChecked: false, deezerSearchVersion: null, itunesSearchVersion: null, masterTitleSearchVersion: null, artVerified: false, artMatchVersion: null };
  }
  return null;
}

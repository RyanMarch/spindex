// values.js - small helpers for deciding whether a piece of data is worth showing

// Discogs and Wikipedia fill gaps with placeholders ("None", "Not On Label"); treat those as no value
export function usefulValue(value) {
  const text = String(value ?? '').trim();
  return /^(none|not on label.*|unknown|n\/?a|-+|\?+)$/i.test(text) ? '' : text;
}

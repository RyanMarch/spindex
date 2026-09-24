// values.js - small helpers for deciding whether a piece of data is worth showing

// Discogs and Wikipedia fill gaps with placeholders ("None", "Not On Label"), and a Wikipedia parse can leak a
// neighbouring field's markup; treat those as no value
export function usefulValue(value) {
  const text = String(value ?? '').trim();
  if (/^(none|not on label.*|unknown|n\/?a|-+|\?+)$/i.test(text)) return '';
  return /^[a-z][a-z_0-9]*\s*=/i.test(text) ? '' : text; // "prev_title = ..." is wiki markup that leaked, not a value
}

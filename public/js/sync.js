// sync.js - Discogs syncing and iTunes art enrichment
import { upsertRecords, updateRecord } from './db.js';

export function parseSortArtist(rawArtist = '') {
  // Strip trailing discogs numeric disambiguations, such as "Duran Duran (2)" -> "Duran Duran"
  const cleaned = rawArtist.replace(/\s\(\d+\)$/, '').trim();
  if (cleaned.toLowerCase().startsWith('the ')) {
    return `${cleaned.slice(4)}, The`;
  }
  return cleaned;
}

export async function syncDiscogsCollection(username, token, onProgress) {
  let page = 1;
  let totalPages = 1;
  const perPage = 100;
  const fetchedRecords = [];

  while (page <= totalPages) {
    const res = await fetch(
      `https://api.discogs.com/users/${encodeURIComponent(username)}/collection/folders/0/releases?page=${page}&per_page=${perPage}`,
      {
        headers: {
          'User-Agent': 'VinylCrate/1.0',
          Authorization: `Discogs token=${token}`,
        },
      }
    );

    if (!res.ok) {
      throw new Error(`Discogs fetch error: ${res.statusText}`);
    }

    const data = await res.json();
    if (data.pagination && data.pagination.pages) {
      totalPages = data.pagination.pages;
    }

    const parsed = (data.releases || []).map((item) => {
      const basic = item.basic_information || {};
      const artistName = basic.artists && basic.artists.length > 0
        ? basic.artists[0].name
        : 'Unknown Artist';

      return {
        id: `discogs_${item.id}`,
        discogsId: item.id,
        masterId: basic.master_id || null,
        title: basic.title || 'Untitled',
        artist: artistName.replace(/\s\(\d+\)$/, '').trim(),
        sortArtist: parseSortArtist(artistName),
        year: basic.year || 0,
        genres: basic.genres || [],
        styles: basic.styles || [],
        format: basic.formats ? basic.formats.map((f) => f.name) : ['Vinyl'],
        dateAdded: item.date_added || new Date().toISOString(),
        notes: item.notes && item.notes[0]?.value ? item.notes[0].value : '',
        tracklist: [],
        artwork: {
          thumbnail: basic.thumb || '',
          highRes: basic.cover_image || '',
          source: 'discogs',
        },
        context: null,
      };
    });

    fetchedRecords.push(...parsed);
    if (onProgress) {
      onProgress({ page, totalPages, count: fetchedRecords.length });
    }
    page++;
  }

  await upsertRecords(fetchedRecords);
  enrichArtInBackground(fetchedRecords);
  return fetchedRecords;
}

export async function enrichArtInBackground(records) {
  for (const record of records) {
    try {
      const query = encodeURIComponent(`${record.artist} ${record.title}`);
      const res = await fetch(`https://itunes.apple.com/search?term=${query}&entity=album&limit=1`);
      if (!res.ok) continue;

      const data = await res.json();
      if (data.resultCount > 0 && data.results[0]?.artworkUrl100) {
        const highRes = data.results[0].artworkUrl100.replace('100x100bb.jpg', '1200x1200bb.jpg');
        await updateRecord(record.id, {
          artwork: {
            thumbnail: data.results[0].artworkUrl100,
            highRes,
            source: 'itunes',
          },
        });
      }
    } catch {
      // Continue to next album if fetch fails
    }
  }
}

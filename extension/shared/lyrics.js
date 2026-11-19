// Lyrics for Listen mode: LRC parsing (with word timings from enhanced LRC), choosing the right
// LRCLIB record, working out what's playing from a page, and turning lyrics into subtitle cues.
(function (root) {
  'use strict';
  const SG = (root.SG = root.SG || {});

  const TIME = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
  const WORD = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g;
  const secs = (m, s) => Number(m) * 60 + Number(String(s).replace(':', '.'));

  // LRC text -> [{ start, end, text, words?: [{ start, text }] }], sorted, with ends filled in.
  // Handles several time tags on one line (repeated choruses) and an [offset:+/-ms] header.
  function parseLRC(text, duration) {
    const lines = [];
    let offset = 0;
    for (const raw of String(text || '').split(/\r?\n/)) {
      const off = raw.match(/^\[offset:\s*([+-]?\d+)\]/i);
      if (off) {
        offset = Number(off[1]) / 1000;
        continue;
      }
      const times = [];
      TIME.lastIndex = 0;
      let m;
      let last = 0;
      while ((m = TIME.exec(raw)) && m.index === last) {
        times.push(secs(m[1], m[2]));
        last = TIME.lastIndex;
      }
      if (!times.length) continue;
      let body = raw.slice(last);
      let words = null;
      if (WORD.test(body)) {
        WORD.lastIndex = 0;
        words = [];
        const parts = body.split(WORD);
        // parts: [before, m, s, text, m, s, text, ...]
        if (parts[0].trim()) words.push({ start: null, text: parts[0] });
        for (let i = 1; i + 1 < parts.length; i += 3) {
          const t = parts[i + 2];
          if (t != null && t !== '') words.push({ start: secs(parts[i], parts[i + 1]), text: t });
        }
        body = words.map((w) => w.text).join('');
      }
      body = body.trim();
      for (const t of times) {
        lines.push({ start: Math.max(0, t - offset), text: body, words: words ? words.map((w) => ({ start: w.start == null ? null : Math.max(0, w.start - offset), text: w.text })) : undefined });
      }
    }
    lines.sort((a, b) => a.start - b.start);
    for (let i = 0; i < lines.length; i++) {
      const next = lines[i + 1];
      const cap = lines[i].start + 12;
      lines[i].end = next ? Math.min(next.start, cap) : Math.min(duration || lines[i].start + 6, cap);
      if (lines[i].end <= lines[i].start) lines[i].end = lines[i].start + 0.5;
      if (!lines[i].words) delete lines[i].words;
    }
    // Empty lines are instrumental gaps: they end the previous line, nothing more.
    return lines.filter((l) => l.text);
  }

  // Plain (unsynced) lyrics -> cues spread over the song, flagged so the sheet can offer Tap to sync.
  function plainToCues(text, duration) {
    const rows = String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const span = (duration || rows.length * 4) / Math.max(1, rows.length);
    return rows.map((t, i) => ({ start: i * span, end: (i + 1) * span, text: t, unsynced: true }));
  }

  // LRCLIB record -> cues (prefers synced lyrics), or null.
  function recordToCues(rec) {
    if (!rec || rec.instrumental) return null;
    if (rec.syncedLyrics) {
      const c = parseLRC(rec.syncedLyrics, rec.duration);
      if (c.length) return { cues: c, synced: true };
    }
    if (rec.plainLyrics) return { cues: plainToCues(rec.plainLyrics, rec.duration), synced: false };
    return null;
  }

  // Best record from an LRCLIB search for the song playing: closest length, synced first.
  function pickRecord(list, want) {
    const norm = (s) => String(s || '').toLowerCase().replace(/[\s\-_'’"“”.,!?・、。()（）[\]【】「」]/g, '');
    let best = null;
    let bestScore = -Infinity;
    for (const r of list || []) {
      if (r.instrumental) continue;
      let score = 0;
      if (want.duration && r.duration) {
        const d = Math.abs(r.duration - want.duration);
        if (d > 8) continue;
        score -= d * 3;
      }
      if (r.syncedLyrics) score += 20;
      if (want.track && norm(r.trackName) === norm(want.track)) score += 15;
      if (want.artist && norm(r.artistName).includes(norm(want.artist))) score += 10;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    return best;
  }

  // Repeated lines (choruses): how many times each text occurs, for "Chorus ×3" marks.
  function repeats(cues) {
    const n = new Map();
    for (const c of cues) n.set(c.text, (n.get(c.text) || 0) + 1);
    return n;
  }

  // "Artist - Song (Official Music Video) [MV]" and similar video titles -> { artist, track }.
  const NOISE = /\s*[(\[【（〔][^)\]】）〕]*(official|mv|m\/v|music video|lyric|lyrics|audio|video|full|live|hd|4k|歌詞|公式|op|ed|opening|ending|feat\.?|ft\.?|prod\.?|remaster|ver\.?|version|tv size|short)[^)\]】）〕]*[)\]】）〕]\s*/gi;
  function parseVideoTitle(title, channel) {
    let t = String(title || '').replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
    // 「Song」 / 『Song』 inside Japanese titles
    const jp = t.match(/^(.*?)\s*[「『](.+?)[」』]/);
    if (jp && jp[2]) return { artist: (jp[1] || '').replace(/[\s/／|｜-]+$/, '').trim() || cleanChannel(channel), track: jp[2].trim() };
    const sep = t.match(/^(.+?)\s+[-–—|｜/／]\s+(.+)$/);
    if (sep) return { artist: sep[1].trim(), track: sep[2].replace(/\s+[-–—|｜].*$/, '').trim() };
    return { artist: cleanChannel(channel), track: t };
  }
  function cleanChannel(c) {
    return String(c || '').replace(/\s*-\s*Topic$/i, '').replace(/\s*(official|公式|チャンネル|channel|VEVO)\s*$/i, '').trim();
  }

  // Is this YouTube video a song? (genre meta, a "- Topic" channel, or the usual words in the title)
  function looksLikeSong(title, channel, genre) {
    if (/music/i.test(genre || '')) return true;
    if (/-\s*Topic$/i.test(channel || '')) return true;
    return /\b(MV|M\/V|music video|official video|lyric video|歌ってみた|full ver)\b|【MV】|\(Official/i.test(title || '');
  }

  function songKey(np) {
    return ['song', (np.artist || '').toLowerCase().trim(), (np.track || '').toLowerCase().trim()].join('|');
  }

  SG.lyrics = { parseLRC, plainToCues, recordToCues, pickRecord, repeats, parseVideoTitle, looksLikeSong, cleanChannel, songKey };
})(typeof globalThis !== 'undefined' ? globalThis : this);

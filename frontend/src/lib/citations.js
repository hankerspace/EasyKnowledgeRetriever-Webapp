// Pure helpers for the LLM's citation format: inline `[n, page p]` markers and a
// trailing `### References` list of `[n] Title (Page p)` lines. No React here so
// it runs under `node --test`.

const REF_HEADER = /\n+\s*(?:#{1,6}\s*|\*\*|__)?\s*(?:references?|sources?|r[ée]f[ée]rences?)\s*(?:\*\*|__)?\s*:?\s*\n/i;
const REF_LINE = /^\s*(?:[-*+]\s*)?\[(\d+)\]\s*(.*?)\s*(?:\((?:page|p\.?)\s*(\d+)\))?\s*$/i;

export function splitReferences(markdown) {
  const text = typeof markdown === 'string' ? markdown : '';
  const m = text.match(REF_HEADER);
  if (!m) return { body: text, references: [] };
  const tail = text.slice(m.index + m[0].length);
  const references = [];
  for (const line of tail.split('\n')) {
    if (!line.trim()) continue;
    const lm = line.match(REF_LINE);
    if (!lm) break; // ponytail: anything after the list ends the list
    references.push({ id: lm[1], title: lm[2].trim(), page: lm[3] ? Number(lm[3]) : null });
  }
  if (references.length === 0) return { body: text, references: [] };
  return { body: text.slice(0, m.index).trimEnd(), references };
}

// `[1]`, `[1, page 2]`, `[1, p. 2]`, `[1, 2]`, `[1, page 2; 3, page 4]`
const CITATION = /\[(\d+(?:\s*,\s*(?:(?:page|p\.?)\s*)?\d+)*(?:\s*;\s*\d+(?:\s*,\s*(?:(?:page|p\.?)\s*)?\d+)*)*)\](?!\()/g;

function parseGroup(group) {
  const out = [];
  for (const part of group.split(';')) {
    const tokens = part.split(',').map((t) => t.trim()).filter(Boolean);
    if (tokens.length === 0) continue;
    const first = { id: tokens[0], page: null };
    const bare = [];
    for (const t of tokens.slice(1)) {
      const pm = t.match(/^(?:page|p\.?)\s*(\d+)$/i);
      if (pm) first.page = Number(pm[1]);
      else if (/^\d+$/.test(t)) bare.push({ id: t, page: null }); // `[4, 5]` = two refs
    }
    out.push(first, ...bare);
  }
  return out;
}

export function parseCitations(text) {
  const seen = new Set();
  const result = [];
  for (const m of (text || '').matchAll(CITATION)) {
    if (Number(m[1].split(/[,;]/)[0]) > 999) continue; // a year, not a citation
    for (const c of parseGroup(m[1])) {
      const key = `${c.id}:${c.page}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(c);
    }
  }
  return result;
}

// Top-level markdown blocks: paragraphs, headings, and each list item on its
// own, so a source rail can sit next to the exact passage it supports.
export function splitBlocks(markdown) {
  const lines = (markdown || '').split('\n');
  const blocks = [];
  let buf = [];
  let inFence = false;
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) blocks.push({ text, citations: parseCitations(text) });
    buf = [];
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (!inFence) flush();
      buf.push(line);
      inFence = !inFence;
      if (!inFence) flush();
      continue;
    }
    if (inFence) { buf.push(line); continue; }
    const isItem = /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
    const isHeading = /^\s*#{1,6}\s/.test(line);
    if (!line.trim()) { flush(); continue; }
    if (isItem || isHeading) flush();
    buf.push(line);
    if (isHeading) flush();
  }
  flush();
  return blocks;
}

export function chunksFor(chunks, id, page) {
  const ofRef = (chunks || []).filter((c) => String(c.reference_id) === String(id));
  if (page == null) return ofRef;
  const inRange = ofRef.filter(
    (c) => c.page_start != null && c.page_start <= page && (c.page_end == null || page <= c.page_end),
  );
  return inRange.length ? inRange : ofRef;
}

export function fileName(path) {
  return (path || '').split(/[\\/]/).pop() || path || '';
}

// Rewrite each citation into markdown links the renderer turns into badges:
// `[1, page 2; 3]` -> `[1](#cite?id=1&page=2)[3](#cite?id=3)`.
export function linkifyCitations(text) {
  return (text || '').replace(CITATION, (m, group) => {
    if (Number(group.split(/[,;]/)[0]) > 999) return m
    return parseGroup(group)
      .map((c) => `[${c.id}](#cite?id=${c.id}${c.page != null ? `&page=${c.page}` : ''})`)
      .join('')
  })
}

// The LLM sometimes escapes newlines or breaks "1. \n item" lists.
export function normalizeAnswer(text) {
  return (text || '').replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/(^|\n)(\d+\.)\s*\n\s*/g, '$1$2 ')
}

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

// `[1]`, `[1, page 2]`, `[1, p. 2]`, `[1, pages 2, 5]`, `[1, 2]`, `[1, page 2; 3, page 4]`
const CITATION = /\[(\d+(?:\s*,\s*(?:(?:pages?|p\.?)\s*)?\d+)*(?:\s*;\s*\d+(?:\s*,\s*(?:(?:pages?|p\.?)\s*)?\d+)*)*)\](?!\()/g
const PAGE = /^(?:pages?|p\.?)\s*(\d+)$/i

// One entry per part: {id, pages: [..]} (pages empty when none). A bare number
// after the id is another reference, unless `knownIds` is given and does not
// contain it: the model often writes `[1, 242]` for "reference 1, page 242".
function parseGroup(group, knownIds) {
  const out = []
  for (const part of group.split(';')) {
    const tokens = part.split(',').map((t) => t.trim()).filter(Boolean)
    if (tokens.length === 0) continue
    const first = { id: tokens[0], pages: [] }
    const extra = []
    let pageMode = false
    for (const t of tokens.slice(1)) {
      const pm = t.match(PAGE)
      if (pm) { pageMode = true; first.pages.push(Number(pm[1])); continue }
      if (!/^\d+$/.test(t)) continue
      const isPage = pageMode || (knownIds && !knownIds.has(t))
      if (isPage) first.pages.push(Number(t))
      else extra.push({ id: t, pages: [] })
    }
    out.push(first, ...extra)
  }
  return out
}

const expand = (entries) => entries.flatMap((e) => (e.pages.length ? e.pages.map((page) => ({ id: e.id, page })) : [{ id: e.id, page: null }]))

export function parseCitations(text, knownIds) {
  const seen = new Set()
  const result = []
  for (const m of (text || '').matchAll(CITATION)) {
    if (Number(m[1].split(/[,;]/)[0]) > 999) continue // a year, not a citation
    for (const c of expand(parseGroup(m[1], knownIds))) {
      const key = `${c.id}:${c.page}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push(c)
    }
  }
  return result
}

// Top-level markdown blocks: paragraphs, headings, and each list item on its
// own, so a source rail can sit next to the exact passage it supports.
export function splitBlocks(markdown, knownIds) {
  const lines = (markdown || '').split('\n');
  const blocks = [];
  let buf = [];
  let inFence = false;
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) blocks.push({ text, citations: parseCitations(text, knownIds) });
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
// `[1, pages 2, 5; 3]` -> `[1](#cite?id=1&pages=2,5)[3](#cite?id=3)`.
export function linkifyCitations(text, knownIds) {
  return (text || '').replace(CITATION, (m, group) => {
    if (Number(group.split(/[,;]/)[0]) > 999) return m
    return parseGroup(group, knownIds)
      .map((c) => `[${c.id}](#cite?id=${c.id}${c.pages.length ? `&pages=${c.pages.join(',')}` : ''})`)
      .join('')
  })
}

// The LLM sometimes escapes newlines or breaks "1. \n item" lists.
export function normalizeAnswer(text) {
  return (text || '').replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/(^|\n)(\d+\.)\s*\n\s*/g, '$1$2 ')
}

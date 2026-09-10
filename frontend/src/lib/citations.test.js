import test from 'node:test';
import assert from 'node:assert/strict';
import { splitReferences, parseCitations, chunksFor, splitBlocks } from './citations.js';

const answer = `L'AI Act classe les systèmes par niveau de risque [1, page 12].

Les obligations des fournisseurs sont détaillées [1, page 30; 2].

### References
- [1] AI Act (Page 12)
- [2] Guide pratique
`;

test('splitReferences separates the body from the reference list', () => {
  const { body, references } = splitReferences(answer);
  assert.ok(!body.includes('### References'));
  assert.ok(body.trim().endsWith('[1, page 30; 2].'));
  assert.deepEqual(references, [
    { id: '1', title: 'AI Act', page: 12 },
    { id: '2', title: 'Guide pratique', page: null },
  ]);
});

test('splitReferences tolerates a bold/plain header and star bullets', () => {
  const { references } = splitReferences('Texte [1].\n\n**References**\n* [1] Doc A (Page 3)');
  assert.deepEqual(references, [{ id: '1', title: 'Doc A', page: 3 }]);
});

test('splitReferences accepts a plural page list and keeps the first page', () => {
  const { body, references } = splitReferences('Texte [1].\n\n## References\n\n* [1] /app/data/doc.pdf (Pages 12, 15, 48–54, 431–433)\n');
  assert.equal(body, 'Texte [1].');
  assert.deepEqual(references, [{ id: '1', title: '/app/data/doc.pdf', page: 12 }]);
});

test('splitReferences leaves text without references alone', () => {
  const { body, references } = splitReferences('Juste du texte [1].');
  assert.equal(body, 'Juste du texte [1].');
  assert.deepEqual(references, []);
});

test('parseCitations reads every inline form the prompt allows', () => {
  assert.deepEqual(parseCitations('a [1] b [2, page 4] c [3, p. 5] d [4, 5] e [6, page 7; 8, page 9]'), [
    { id: '1', page: null }, { id: '2', page: 4 }, { id: '3', page: 5 },
    { id: '4', page: null }, { id: '5', page: null }, { id: '6', page: 7 }, { id: '8', page: 9 },
  ]);
});

test('parseCitations handles plural pages and bare page numbers when ids are known', () => {
  assert.deepEqual(parseCitations('[1, pages 54, 427, 431]'), [{ id: '1', page: 54 }, { id: '1', page: 427 }, { id: '1', page: 431 }]);
  assert.deepEqual(parseCitations('[1, 242]', new Set(['1'])), [{ id: '1', page: 242 }]);
  assert.deepEqual(parseCitations('[1, 2]', new Set(['1', '2'])), [{ id: '1', page: null }, { id: '2', page: null }]);
});

test('parseCitations dedupes and ignores markdown links / years', () => {
  assert.deepEqual(parseCitations('[1] et encore [1]. Voir [texte](url) en [2024].'), [{ id: '1', page: null }]);
});

test('splitBlocks keeps list items and paragraphs as separate blocks', () => {
  const blocks = splitBlocks('Intro [1].\n\n- item un [2]\n- item deux\n\n## Titre\n\nFin.');
  assert.deepEqual(blocks.map((b) => b.text), ['Intro [1].', '- item un [2]', '- item deux', '## Titre', 'Fin.']);
  assert.deepEqual(blocks[1].citations, [{ id: '2', page: null }]);
});

test('splitBlocks keeps a fenced code block whole', () => {
  const blocks = splitBlocks('Avant\n\n```js\n- pas une liste\n\nx\n```\n\nAprès');
  assert.equal(blocks.length, 3);
  assert.ok(blocks[1].text.startsWith('```'));
});

const chunks = [
  { chunk_id: 'a', reference_id: '1', file_path: '/d/AI Act.pdf', page_start: 10, page_end: 14, content: 'A' },
  { chunk_id: 'b', reference_id: '1', file_path: '/d/AI Act.pdf', page_start: 30, page_end: 31, content: 'B' },
  { chunk_id: 'c', reference_id: '2', file_path: '/d/Guide.md', page_start: null, page_end: null, content: 'C' },
];

test('chunksFor narrows to the cited page range, else the whole reference', () => {
  assert.deepEqual(chunksFor(chunks, '1', 12).map((c) => c.chunk_id), ['a']);
  assert.deepEqual(chunksFor(chunks, '1', null).map((c) => c.chunk_id), ['a', 'b']);
  assert.deepEqual(chunksFor(chunks, '1', 99).map((c) => c.chunk_id), ['a', 'b']);
  assert.deepEqual(chunksFor(chunks, '2', 3).map((c) => c.chunk_id), ['c']);
  assert.deepEqual(chunksFor(chunks, '9', null), []);
});

test('linkifyCitations turns markers into cite links, one per reference', async () => {
  const { linkifyCitations } = await import('./citations.js')
  assert.equal(linkifyCitations('x [1, page 2; 3] y [2024]'), 'x [1](#cite?id=1&pages=2)[3](#cite?id=3) y [2024]')
  assert.equal(linkifyCitations('[1, pages 54, 427]'), '[1](#cite?id=1&pages=54,427)')
  assert.equal(linkifyCitations('[1, 242]', new Set(['1'])), '[1](#cite?id=1&pages=242)')
})

test('chunksFor accepts a list of pages', () => {
  assert.deepEqual(chunksFor(chunks, '1', [12, 30]).map((c) => c.chunk_id), ['a', 'b']);
});

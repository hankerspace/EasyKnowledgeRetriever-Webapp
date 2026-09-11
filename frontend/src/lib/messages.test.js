import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MESSAGES, LANGUAGES, pickLanguage, translate } from './messages.js';

test('every message exists in every language', () => {
  const reference = Object.keys(MESSAGES.en).sort();
  for (const lang of LANGUAGES) assert.deepEqual(Object.keys(MESSAGES[lang]).sort(), reference, lang);
});

test('every key used in the source is defined', () => {
  const src = fileURLToPath(new URL('..', import.meta.url));
  const files = readdirSync(src, { recursive: true }).filter((f) => /\.(jsx?|tsx?)$/.test(f) && !f.includes('.test.'));
  const missing = [];
  for (const file of files) {
    for (const [, key] of readFileSync(join(src, file), 'utf8').matchAll(/\bt\(\s*['"]([\w. ]+)['"]/g)) {
      if (!(key in MESSAGES.en) && !(`${key}_other` in MESSAGES.en)) missing.push(`${file}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('interpolation and plural forms follow the language', () => {
  assert.equal(translate('en', 'answer.excerpts', { count: 1 }), '1 excerpt');
  assert.equal(translate('en', 'answer.excerpts', { count: 0 }), '0 excerpts');
  assert.equal(translate('fr', 'answer.excerpts', { count: 0 }), '0 extrait');
  assert.equal(translate('fr', 'answer.excerpts', { count: 3 }), '3 extraits');
  assert.equal(translate('fr', 'chat.ingesting', { done: 2, total: 5 }), 'Ingestion en cours (2/5)');
  assert.equal(translate('fr', 'no.such.key'), 'no.such.key');
});

test('English is the default language', () => {
  assert.equal(pickLanguage(null, null, undefined), 'en');
  assert.equal(pickLanguage(null, 'fr', 'en'), 'fr');
  assert.equal(pickLanguage('de', null, 'fr'), 'fr');
});

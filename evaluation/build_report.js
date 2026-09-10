// Génère Rapport_Evaluation_RAG_AI_Act.docx à la racine du projet à partir de
// out/summary.json, out/ingestion_stats.json et out/analysis.json.
// Usage : NODE_PATH=<dossier contenant node_modules/docx> node evaluation/build_report.js
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType,
  BorderStyle, AlignmentType, TableOfContents, Header, Footer, PageNumber, LevelFormat, PageBreak, VerticalAlign,
} = require('docx');

const EV = process.env.EVAL_OUT_DIR || path.join(__dirname, 'out'); // summary.json, ingestion_stats.json, analysis.json
const S = JSON.parse(fs.readFileSync(path.join(EV, 'summary.json')));
const I = JSON.parse(fs.readFileSync(path.join(EV, 'ingestion_stats.json')));
const A = JSON.parse(fs.readFileSync(path.join(EV, 'analysis.json')));
const OUT = process.env.EVAL_REPORT || path.join(__dirname, '..', '..', 'doc', 'Rapport_Evaluation_RAG_AI_Act.docx');

const W = 9638; // A4 - 2 cm de marges
const ACCENT = '1F4E79', GREY = 'F2F2F2', GOOD = 'E2F0D9', MID = 'FFF2CC', BAD = 'F8D7DA';
const fr = (v, d) => v.toFixed(d).replace('.', ',');
const pct = v => (v == null ? '—' : fr(v * 100, 1) + ' %');
const num = (v, d = 2) => (v == null ? '—' : fr(v, d));
const sec = v => (v == null ? '—' : fr(v, 1) + ' s');
const score = v => (v == null ? '—' : fr(v, 2) + ' / 5');
const tone = (v, good, bad, higher = true) =>
  v == null ? undefined : higher ? (v >= good ? GOOD : v <= bad ? BAD : MID) : (v <= good ? GOOD : v >= bad ? BAD : MID);

const rankCell = r => (r.hit == null ? { t: 'n/a' }
  : r.decomposed ? { t: 'D', fill: MID }
  : r.hit ? { t: String(r.first_rank), fill: r.first_rank <= 5 ? GOOD : MID } : { t: 'absent', fill: BAD });

const CFG = {
  hybrid_mix: 'hybrid_mix (défaut)', naive: 'naive', mix: 'mix', hybrid: 'hybrid',
  hybrid_mix_decomp: 'hybrid_mix avec décomposition', hybrid_mix_repet2: 'hybrid_mix, 2e passage', hybrid_mix_repet3: 'hybrid_mix, 3e passage',
  hybrid_mix_qwen_3_6_35b_instruct: 'hybrid_mix, générateur qwen-3.6-35b',
};
const CFG_SHORT = {
  hybrid_mix: 'hybrid_mix (défaut)', naive: 'naive', mix: 'mix', hybrid: 'hybrid',
  hybrid_mix_decomp: 'avec décomp.', hybrid_mix_repet2: '2e passage', hybrid_mix_repet3: '3e passage',
  hybrid_mix_qwen_3_6_35b_instruct: 'générateur qwen',
};
// exclus du classement : passages répétés (variance) et générateur alternatif (latence = génération seule)
const isRepeat = c => c.includes('_repet') || c.includes('qwen');
const configs = Object.keys(CFG).filter(k => S.configs[k]);
const D = S.configs.hybrid_mix;

// --- primitives -------------------------------------------------------------
function runs(text, o = {}) {
  return String(text ?? '—').split(/(\*\*[^*]+\*\*)/).filter(Boolean).map(s =>
    s.startsWith('**') && s.endsWith('**')
      ? new TextRun({ text: s.slice(2, -2), bold: true, size: o.size, color: o.color, font: o.font })
      : new TextRun({ text: s, size: o.size, color: o.color, italics: o.italics, bold: o.bold, font: o.font }));
}
const P = (t, o = {}) => new Paragraph({ spacing: { after: 120 }, alignment: o.align, children: runs(t, o) });
const H = (t, l = 1) => new Paragraph({ heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][l - 1], children: [new TextRun(t)] });
const B = (t, level = 0) => new Paragraph({ numbering: { reference: 'bullets', level }, spacing: { after: 60 }, children: runs(t) });
const CODE = t => new Paragraph({ spacing: { after: 40 }, shading: { fill: GREY, type: ShadingType.CLEAR, color: 'auto' }, children: [new TextRun({ text: t, font: 'Consolas', size: 17 })] });
const BREAK = () => new Paragraph({ children: [new PageBreak()] });
const CAPTION = t => new Paragraph({ spacing: { before: 60, after: 200 }, children: [new TextRun({ text: t, italics: true, size: 17, color: '595959' })] });

function cell(content, w, o = {}) {
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: o.fill ? { fill: o.fill, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    borders: o.borders,
    children: [new Paragraph({ alignment: o.align, children: runs(content, { size: o.size || 18, bold: o.bold, color: o.color }) })],
  });
}

// rows: tableaux de valeurs ou {t, fill, bold}
function table(widths, header, rows, o = {}) {
  const size = o.size || 18;
  const al = i => (o.align ? o.align[i] : undefined);
  const head = new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, widths[i], { fill: ACCENT, color: 'FFFFFF', bold: true, size, align: al(i) })) });
  const body = rows.map((r, ri) => new TableRow({
    cantSplit: true,
    children: r.map((c, i) => {
      const x = c && typeof c === 'object' ? c : { t: c };
      return cell(x.t, widths[i], { fill: x.fill || (ri % 2 ? GREY : undefined), size, bold: x.bold, align: al(i) });
    }),
  }));
  return new Table({ width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: widths, rows: [head, ...body] });
}

// Barres horizontales natives : 20 cellules ombrées
function bars(items, { max = 1, fmt = pct } = {}) {
  const N = 20, cw = 300, lw = 2638, vw = W - lw - N * cw;
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const nb = { top: none, bottom: none, left: none, right: none };
  const gap = { style: BorderStyle.SINGLE, size: 18, color: 'FFFFFF' };
  const rows = items.map(it => {
    const n = Math.round(Math.max(0, Math.min(1, (it.value || 0) / max)) * N);
    return new TableRow({
      children: [
        cell(it.label, lw, { borders: nb, size: 17 }),
        ...Array.from({ length: N }, (_, i) => new TableCell({
          width: { size: cw, type: WidthType.DXA },
          borders: { top: gap, bottom: gap, left: none, right: none },
          shading: { fill: i < n ? (it.color || ACCENT) : 'EDEDED', type: ShadingType.CLEAR, color: 'auto' },
          children: [new Paragraph({ children: [new TextRun({ text: '', size: 8 })] })],
        })),
        cell(fmt(it.value), vw, { borders: nb, size: 17, bold: true, align: AlignmentType.RIGHT }),
      ],
    });
  });
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [lw, ...Array(N).fill(cw), vw], rows });
}

const kv = (pairs, w1 = 3600) => table([w1, W - w1], ['Élément', 'Valeur'], pairs);

// --- contenu ------------------------------------------------------------------
const body = [];
const add = (...xs) => body.push(...xs.flat());

// Page de titre
add(
  new Paragraph({ spacing: { before: 2400 }, children: [] }),
  new Paragraph({ children: [new TextRun({ text: "Rapport d'évaluation", size: 56, bold: true, color: ACCENT })] }),
  new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: 'Dedhicated RAG — performances sur le règlement européen sur l\'IA', size: 32, color: '404040' })] }),
  new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 4 } }, spacing: { after: 480 }, children: [] }),
  kv([
    ['Date de l\'évaluation', A.date],
    ['Système évalué', 'Application Dedhicated RAG (conteneur local easy_knowledge_retriever, port 85)'],
    ['Bibliothèque', `easy-knowledge-retriever ${I.lib_version}`],
    ['Document ingéré', `${I.file} — ${I.pages} pages, ${I.doc_words.toLocaleString('fr-FR')} mots`],
    ['Jeu de test', `${S.dataset.length} questions, ${configs.length} configurations, ${Object.values(S.configs).reduce((a, c) => a + c.n, 0)} requêtes évaluées`],
    ['Méthode', 'Métriques déterministes (récupération, faits attendus) + juge LLM + revue manuelle'],
  ]),
  BREAK(),
  new TableOfContents('Sommaire', { hyperlink: true, headingStyleRange: '1-2' }),
  BREAK(),
);

// 1. Synthèse
add(H('1. Synthèse'), ...A.verdict.map(t => P(t)));
add(H('1.1 Indicateurs clés (configuration par défaut)', 2));
const kpi = [
  ['Requêtes réussies', pct(D.success_rate), 'Latence médiane / p95', `${sec(D.latency_p50)} / ${sec(D.latency_p95)}`],
  ['Chunk de preuve récupéré (hit rate)', pct(D.hit_rate), 'Preuve dans le top 5', pct(D.hit_at_5)],
  ['MRR (rang de la preuve)', num(D.mrr), 'Précision du contexte', pct(D.context_precision)],
  ['Rappel des faits attendus', pct(D.fact_recall), 'Taux d\'hallucination (juge)', pct(D.hallucination_rate)],
  ['Exactitude (juge)', score(D.correctness), 'Fidélité au contexte (juge)', score(D.faithfulness)],
  ['Complétude (juge)', score(D.completeness), 'Pièges réussis (hors périmètre, prémisses, date)', pct(D.trap_pass_rate)],
  ['Hit rate (requêtes non décomposées)', pct(D.hit_rate_non_decomposed), 'Réponses correctes (revue manuelle)', A.manual_score],
];
add(table([3019, 1800, 3019, 1800], ['Indicateur', 'Valeur', 'Indicateur', 'Valeur'], kpi.map(r => [r[0], { t: r[1], bold: true }, r[2], { t: r[3], bold: true }]), { align: [undefined, AlignmentType.CENTER, undefined, AlignmentType.CENTER] }));
add(CAPTION('Configuration par défaut de l\'application : mode hybrid_mix, décomposition de requête activée, top_k 10, chunk_top_k 20, reranker bge-reranker-v2-m3.'));
add(H('1.2 Points forts', 2), ...A.strengths.map(t => B(t)));
add(H('1.3 Points faibles', 2), ...A.weaknesses.map(t => B(t)));
add(H('1.4 Recommandations prioritaires', 2), ...A.recommendations.slice(0, 5).map(r => B(`**${r.action}** — ${r.why}`)));

// 2. Système évalué
add(BREAK(), H('2. Système évalué'), P(A.system_intro));
add(H('2.1 Architecture et paramètres', 2), kv([
  ['LLM (génération, extraction, juge)', 'mistral-small-4-119b via ILAAS (llm.ilaas.fr, API compatible OpenAI)'],
  ['Embeddings', 'bge-m3, 1024 dimensions, encodage float (rag-api.ilaas.fr)'],
  ['Reranker', 'bge-reranker-v2-m3 (rag-api.ilaas.fr/v1/rerank)'],
  ['Stockage', 'JSON KV + NanoVectorDB (seuil cosinus 0,2) + graphe NetworkX'],
  ['Découpage', 'Chunks de 1 200 tokens, chevauchement 100 tokens'],
  ['Récupération (défaut)', 'hybrid_mix : graphe (entités + relations, bas et haut niveau) + vecteurs, reranking'],
  ['Budget de contexte', 'top_k 10, chunk_top_k 20, max 6 000 tokens entités / 8 000 relations / 30 000 au total'],
  ['Décomposition de requête', 'Activée par défaut (mots-clés haut / bas niveau extraits par le LLM)'],
  ['Concurrence', 'EKR_MAX_ASYNC = 4, EKR_EMBEDDING_MAX_ASYNC = 4, lots d\'embeddings de 32'],
  ['Déploiement', 'Docker (nginx + supervisord + uvicorn), authentification HTTP Basic'],
]));

// 3. Ingestion
add(H('3. Ingestion et qualité de l\'index'), P(A.ingestion_intro));
add(H('3.1 Statistiques d\'ingestion', 2), kv([
  ['Fichier source', `${I.file} (${fr(I.pdf_bytes / 1e6, 2)} Mo)`],
  ['Pages / caractères / mots', `${I.pages} / ${I.doc_chars.toLocaleString('fr-FR')} / ${I.doc_words.toLocaleString('fr-FR')}`],
  ['Durée d\'ingestion', `${I.ingest_seconds} s (${fr(I.ingest_seconds / 60, 1)} min), soit ${fr(I.ingest_seconds / I.pages, 1)} s par page`],
  ['Chunks', `${I.chunks} (tokens : moyenne ${I.chunk_tokens.mean}, médiane ${I.chunk_tokens.median}, min ${I.chunk_tokens.min}, max ${I.chunk_tokens.max} ; total ${I.chunk_tokens.total.toLocaleString('fr-FR')})`],
  ['Granularité', `≈ ${fr(I.pages / I.chunks, 1)} pages par chunk`],
  ['Graphe de connaissances', `${I.graph_nodes} entités, ${I.graph_edges} relations, degré moyen ${num(I.degree.mean)}, degré max ${I.degree.max}`],
  ['Entités isolées (sans relation)', `${I.isolated_nodes} (${pct(I.isolated_nodes / I.graph_nodes)})`],
  ['Index vectoriels', `${I['vdb_chunks.json']} chunks, ${I['vdb_entities.json']} entités, ${I['vdb_relationships.json']} relations`],
  ['Cache LLM persistant', `${I.llm_cache_entries} entrées (${I.llm_cache_by_mode.map(([k, v]) => `${k} ${v}`).join(', ')})`],
  ['Volume disque de l\'index', `${fr(I.storage_total_mb, 1)} Mo`],
]));
add(H('3.2 Types d\'entités extraits', 2));
add(bars(I.entity_types.map(([k, v]) => ({ label: k, value: v })), { max: I.entity_types[0][1], fmt: v => String(v) }));
add(CAPTION('Nombre d\'entités par type (12 types les plus fréquents).'));
add(H('3.3 Entités les plus connectées', 2));
add(table([600, 5038, 2000, 2000], ['#', 'Entité', 'Degré', 'Remarque'], I.top_entities.map(([n, d], i) => [String(i + 1), n, String(d), (A.entity_notes || {})[n] || ''])));
add(H('3.4 Constats', 2), ...A.ingestion_obs.map(t => B(t)));

// 4. Méthodologie
add(BREAK(), H('4. Méthodologie'), ...A.method_intro.map(t => P(t)));
add(H('4.1 Composition du jeu de test', 2));
const CAT_DESC = {
  'définition': 'Définitions de l\'article 3', 'obligation': 'Obligations des opérateurs (art. 4, 26, 27, 50, 53)',
  'interdiction': 'Pratiques interdites précises (art. 5)', 'liste': 'Énumération complète (art. 5)',
  'classification': 'Haut risque (art. 6, annexe III)', 'sanctions': 'Amendes (art. 99, 100)',
  'numérique': 'Seuils et délais chiffrés (art. 51, 73)', 'calendrier': 'Entrée en application (art. 113)',
  'piège-hallucination': 'Donnée absente du document (date calendaire)', "champ d'application": 'Exclusions et extraterritorialité (art. 2)',
  'gouvernance': 'Bacs à sable réglementaires (art. 57)', 'multi-sauts': 'Synthèse sur plusieurs articles (art. 9-15, 53/55)',
  'multilingue': 'Question en anglais sur un corpus français', 'formulation vague': 'Question familière et imprécise',
  'hors périmètre': 'Réponse absente du corpus : refus attendu', 'fausse prémisse': 'Question fondée sur une affirmation fausse',
};
const cats = {};
S.dataset.forEach(d => { cats[d.category] = (cats[d.category] || 0) + 1; });
add(table([2600, 900, 6138], ['Catégorie', 'Questions', 'Ce qui est testé'], Object.entries(cats).map(([c, n]) => [c, String(n), CAT_DESC[c] || ''])));
add(H('4.2 Configurations comparées', 2));
add(table([3000, 6638], ['Configuration', 'Description'], [
  ['hybrid_mix (défaut)', 'Graphe (entités + relations) + recherche vectorielle de chunks + reranking, sans décomposition de requête. Réglage de l\'application.'],
  ['naive', 'RAG vectoriel classique : similarité sur les chunks uniquement.'],
  ['mix', 'Graphe + vecteurs, sans la variante « hybrid » bas/haut niveau combinée du mode par défaut.'],
  ['hybrid', 'Graphe seul (entités locales + relations globales), chunks rattachés aux entités.'],
  ['avec décomp.', 'hybrid_mix avec query_decomposition = true (ancien défaut).'],
  ['2e / 3e passage', 'Même série que le défaut, rejouée deux fois : mesure la reproductibilité des réponses.'],
]));
add(H('4.3 Métriques', 2));
add(table([2600, 7038], ['Métrique', 'Définition'], [
  ['Hit rate', 'Part des questions (avec preuve) où au moins un chunk contenant le passage de référence figure dans les chunks renvoyés. Les chunks de preuve sont identifiés par expression régulière sur le texte ingéré.'],
  ['Hit@5 / MRR', 'Preuve présente dans les 5 premiers chunks / moyenne de 1 ÷ rang du premier chunk de preuve (0 si absent).'],
  ['Précision du contexte', 'Part des chunks renvoyés qui sont des chunks de preuve (faible par construction : 1 à 4 chunks de preuve pour ~20 renvoyés).'],
  ['Rappel des faits', 'Part des éléments attendus (montants, conditions, termes juridiques) retrouvés dans la réponse, par expression régulière.'],
  ['Exactitude / Complétude', 'Note 0-5 du juge LLM par rapport à la réponse de référence rédigée à partir du document.'],
  ['Fidélité', 'Note 0-5 du juge : les affirmations sont-elles étayées par le contexte réellement envoyé au LLM (section Context du prompt système : entités, relations, chunks) ?'],
  ['Hallucination', 'Le juge relève au moins une affirmation fausse ou non étayée.'],
  ['Hors périmètre / prémisse', 'Pour les questions pièges : le système a-t-il signalé l\'absence d\'information ou corrigé la prémisse ?'],
  ['Réponse interdite', 'La réponse contient une information absente du document (ex. date calendaire, capitale, amendes RGPD).'],
  ['Citations', 'Présence de références [n, page p] ; cohérence des pages citées (±2) avec les pages des chunks de preuve.'],
  ['Latence', 'Temps de bout en bout de POST /query (récupération + génération, sans streaming), 4 requêtes en parallèle.'],
]));
add(H('4.4 Limites de la méthode', 2), ...A.limitations.map(t => B(t)));

// 5. Résultats globaux
add(BREAK(), H('5. Résultats de la configuration par défaut'), ...A.results_intro.map(t => P(t)));
add(H('5.1 Vue d\'ensemble', 2));
add(bars([
  { label: 'Requêtes réussies', value: D.success_rate },
  { label: 'Hit rate (preuve récupérée)', value: D.hit_rate },
  { label: 'Hit@5', value: D.hit_at_5 },
  { label: 'Hit rate (non décomposées)', value: D.hit_rate_non_decomposed },
  { label: 'Rappel des faits', value: D.fact_recall },
  { label: 'Exactitude (÷5)', value: D.correctness / 5 },
  { label: 'Complétude (÷5)', value: D.completeness / 5 },
  { label: 'Fidélité (÷5)', value: D.faithfulness / 5 },
  { label: 'Sans hallucination', value: 1 - D.hallucination_rate, color: '548235' },
  { label: 'Citations présentes', value: D.citation_rate },
]));
add(CAPTION('Scores normalisés entre 0 et 100 % (notes du juge divisées par 5).'));
add(H('5.2 Résultats par catégorie', 2));
add(table([2238, 600, 1100, 1000, 1100, 1200, 1200, 1200], ['Catégorie', 'n', 'Hit rate', 'MRR', 'Faits', 'Exactitude', 'Fidélité', 'Halluc.'],
  Object.entries(S.categories_default).map(([c, m]) => [c, String(m.n), { t: pct(m.hit_rate), fill: tone(m.hit_rate, .8, .4) }, num(m.mrr),
    { t: pct(m.fact_recall), fill: tone(m.fact_recall, .8, .5) }, { t: num(m.correctness), fill: tone(m.correctness, 4, 2.5) },
    { t: num(m.faithfulness), fill: tone(m.faithfulness, 4, 2.5) }, { t: pct(m.hallucination_rate), fill: tone(m.hallucination_rate, .2, .5, false) }]),
  { size: 17 }));
add(CAPTION('Vert : bon ; jaune : moyen ; rouge : insuffisant. « — » : non applicable (pas de preuve attendue).'));
add(H('5.3 Détail par question', 2));
add(table([600, 1400, 800, 850, 800, 800, 850, 850, 2688], ['Q', 'Catégorie', 'Rang', 'Faits', 'Exact.', 'Fidél.', 'Halluc.', 'Latence', 'Commentaire du juge'],
  S.per_question_default.map(r => {
    const j = r.judge || {};
    return [r.qid, r.category,
      rankCell(r),
      { t: r.fact_recall == null ? 'n/a' : pct(r.fact_recall), fill: tone(r.fact_recall, .8, .5) },
      { t: j.correctness ?? '—', fill: tone(j.correctness, 4, 2) }, { t: j.faithfulness ?? '—', fill: tone(j.faithfulness, 4, 2) },
      { t: j.hallucination == null ? '—' : j.hallucination ? 'oui' : 'non', fill: j.hallucination ? BAD : GOOD },
      sec(r.latency_s), j.comment || j.error || ''];
  }), { size: 15 }));

add(CAPTION('Rang : position du premier chunk de preuve parmi les chunks renvoyés par l\'API. « D » : requête décomposée, l\'API ne renvoie aucun chunk (récupération non mesurable).'));
add(H('5.4 Revue manuelle', 2), ...A.manual_intro.map(t => P(t)));
add(table([600, 1900, 7138], ['Q', 'Verdict', 'Observation'], Object.entries(A.manual_review).map(([q, [v, note]]) => [q, { t: v, fill: v === 'Correct' ? GOOD : v === 'Incorrect' ? BAD : MID }, note]), { size: 16 }));

// 6. Comparaison des modes
add(BREAK(), H('6. Comparaison des configurations'), ...A.modes_intro.map(t => P(t)));
const ROWS = [
  ['Requêtes réussies', 'success_rate', pct, true], ['Hit rate', 'hit_rate', pct, true], ['Hit@5', 'hit_at_5', pct, true],
  ['MRR', 'mrr', num, true], ['Hit rate (non décomposées)', 'hit_rate_non_decomposed', pct, true], ['Requêtes décomposées', 'decomposed_rate', pct, null], ['Précision du contexte', 'context_precision', pct, true], ['Rappel des faits', 'fact_recall', pct, true],
  ['Exactitude (/5)', 'correctness', num, true], ['Complétude (/5)', 'completeness', num, true], ['Fidélité (/5)', 'faithfulness', num, true],
  ['Taux d\'hallucination', 'hallucination_rate', pct, false], ['Pièges réussis', 'trap_pass_rate', pct, true],
  ['Réponse interdite', 'forbidden_rate', pct, false], ['Citations présentes', 'citation_rate', pct, true], ['Pages citées cohérentes', 'citation_page_ok', pct, true],
  ['Latence médiane', 'latency_p50', sec, false], ['Latence p95', 'latency_p95', sec, false], ['Latence moyenne', 'latency_mean', sec, false], ['Latence moy. (décomposées)', 'latency_mean_decomposed', sec, null], ['Latence moy. (directes)', 'latency_mean_direct', sec, null],
  ['Chunks renvoyés (moy.)', 'n_chunks_mean', v => num(v, 1), null], ['Longueur de réponse (car.)', 'answer_chars_mean', v => num(v, 0), null],
];
const cw = Math.floor((W - 2642) / configs.length);
add(table([W - cw * configs.length, ...Array(configs.length).fill(cw)], ['Métrique', ...configs.map(c => CFG_SHORT[c])],
  ROWS.map(([label, key, f, higher]) => {
    const vals = configs.map(c => S.configs[c][key]);
    const cand = configs.filter(c => !isRepeat(c)).map(c => S.configs[c][key]).filter(v => v != null);
    const best = higher == null || !cand.length ? null : higher ? Math.max(...cand) : Math.min(...cand);
    return [label, ...vals.map((v, i) => {
      const win = best != null && v === best && !isRepeat(configs[i]);
      return { t: f(v), bold: win, fill: win ? GOOD : undefined };
    })];
  }), { size: 16, align: [undefined, ...configs.map(() => AlignmentType.CENTER)] }));
add(CAPTION('En gras sur fond vert : meilleure valeur parmi les configurations « à froid » (les passages répétés sont exclus du classement).'));
add(H('6.1 Exactitude par configuration', 2));
add(bars(configs.map(c => ({ label: CFG[c], value: S.configs[c].correctness })), { max: 5, fmt: score }));
add(H('6.2 Récupération de la preuve (hit rate)', 2));
add(bars(configs.map(c => ({ label: CFG[c], value: S.configs[c].hit_rate }))));
add(H('6.3 Analyse', 2), ...A.modes_obs.map(t => B(t)));

// 7. Latence
add(BREAK(), H('7. Latence et reproductibilité'), ...A.latency_intro.map(t => P(t)));
const maxLat = Math.max(...configs.map(c => S.configs[c].latency_p95 || 0));
add(H('7.1 Latence médiane', 2), bars(configs.map(c => ({ label: CFG[c], value: S.configs[c].latency_p50 })), { max: maxLat, fmt: sec }));
add(H('7.2 Latence p95', 2), bars(configs.map(c => ({ label: CFG[c], value: S.configs[c].latency_p95, color: 'C55A11' })), { max: maxLat, fmt: sec }));
if (S.repeatability && Object.keys(S.repeatability).length) {
  add(H('7.3 Reproductibilité', 2));
  add(table([3000, 1500, 2000, 1638, 1500], ['Comparaison', 'Questions', 'Réponses identiques', 'Même verdict', 'Écart moyen'],
    Object.entries(S.repeatability).map(([c, m]) => [`${CFG[c]} vs défaut`, String(m.n), String(m.identical_answers), String(m.same_verdict), num(m.mean_abs_diff)])));
}
add(H('7.4 Constats', 2), ...A.latency_obs.map(t => B(t)));

// 8. Robustesse
add(BREAK(), H('8. Robustesse : pièges, hors périmètre, multilingue'), ...A.robustness_intro.map(t => P(t)));
const ROB = Object.keys(A.robustness);
add(table([600, 3000, 1300, 4738], ['Q', 'Question', 'Verdict', 'Comportement observé (config. par défaut)'],
  ROB.map(q => {
    const d = S.dataset.find(x => x.qid === q);
    const v = A.robustness[q];
    return [q, d.question, { t: v.verdict, fill: v.verdict === 'Réussi' ? GOOD : v.verdict === 'Échec' ? BAD : MID }, v.observed];
  }), { size: 16 }));
add(H('8.1 Constats', 2), ...A.robustness_obs.map(t => B(t)));

// 9. Analyse qualitative
add(BREAK(), H('9. Analyse qualitative des réponses'), ...A.qualitative_intro.map(t => P(t)));
A.qualitative.forEach(q => {
  add(H(q.title, 2));
  if (q.question) add(P(`**Question** : ${q.question}`));
  if (q.excerpt) add(new Paragraph({ spacing: { after: 120 }, indent: { left: 400 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'A6A6A6', space: 8 } }, children: runs(q.excerpt, { italics: true, size: 19, color: '404040' }) }));
  (Array.isArray(q.text) ? q.text : [q.text]).forEach(t => add(P(t)));
});

// 10. Recommandations
add(BREAK(), H('10. Recommandations'), P(A.recommendations_intro));
add(table([500, 3000, 4138, 1000, 1000], ['#', 'Action', 'Justification (constat de l\'évaluation)', 'Impact', 'Effort'],
  A.recommendations.map((r, i) => [String(i + 1), { t: r.action, bold: true }, r.why, { t: r.impact, fill: r.impact === 'Élevé' ? GOOD : undefined }, r.effort]), { size: 16 }));
add(H('10.1 Conclusion', 2), ...A.conclusion.map(t => P(t)));

// Annexes
add(BREAK(), H('Annexe A. Jeu de questions et réponses de référence'));
add(table([600, 1300, 3300, 3538, 900], ['Q', 'Catégorie', 'Question', 'Réponse de référence', 'Pages preuve'],
  S.dataset.map(d => [d.qid, d.category, d.question, d.reference, d.gold_pages.length ? d.gold_pages.join(', ') : '—']), { size: 15 }));
add(BREAK(), H('Annexe B. Matrice question × configuration'));
add(P('Chaque cellule : note d\'exactitude du juge (0-5) · rang du premier chunk de preuve (« ✗ » si absent, « – » si non applicable, « D » : requête décomposée, aucun chunk renvoyé par l\'API).'));
const M = {};
S.per_question_all.forEach(r => { (M[r.qid] = M[r.qid] || {})[r.config] = r; });
add(table([W - cw * configs.length, ...Array(configs.length).fill(cw)], ['Q', ...configs.map(c => CFG_SHORT[c])],
  S.dataset.map(d => [d.qid, ...configs.map(c => {
    const r = (M[d.qid] || {})[c];
    if (!r) return '—';
    const rank = r.hit == null ? '–' : r.decomposed ? 'D' : r.hit ? `r${r.first_rank}` : '✗';
    return { t: `${r.correctness ?? '—'} · ${rank}`, fill: tone(r.correctness, 4, 2) };
  })]), { size: 16, align: [undefined, ...configs.map(() => AlignmentType.CENTER)] }));
add(BREAK(), H('Annexe C. Reproduire l\'évaluation'));
add(P('Prérequis : conteneur easy_knowledge_retriever démarré sur le port 85 avec l\'index du règlement IA, fichier dedhicated-app/.env renseigné, paquet npm docx accessible. Depuis la racine du projet :'));
['cd webapp/evaluation && npm install', 'python eval_rag.py check', 'python eval_rag.py stats', 'python eval_rag.py run', 'python eval_rag.py report', 'node build_report.js']
  .forEach(c => add(CODE(c)));
add(P('Fichiers produits : out/results.jsonl (une ligne par requête : réponse complète, rangs, faits manquants, verdict du juge), out/summary.json (agrégats), out/ingestion_stats.json (statistiques d\'index), out/analysis.json (analyse rédigée). La commande run reprend là où elle s\'est arrêtée ; supprimer results.jsonl pour repartir à froid.'));
add(P(`Données générées le ${S.generated_at}.`, { italics: true, color: '7F7F7F', size: 17 }));

// --- document -------------------------------------------------------------------
const doc = new Document({
  creator: 'Dedhicated RAG — évaluation automatisée',
  title: 'Rapport d\'évaluation RAG — AI Act',
  features: { updateFields: true },
  styles: {
    default: { document: { run: { font: 'Calibri', size: 21 }, paragraph: { spacing: { line: 276 } } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, color: ACCENT }, paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 25, bold: true, color: '2E75B6' }, paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, color: '404040' }, paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 560, hanging: 280 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1120, hanging: 280 } } } },
      ],
    }],
  },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'Rapport d\'évaluation RAG — AI Act', size: 16, color: '7F7F7F' })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 16, color: '7F7F7F' })] })] }) },
    children: body,
  }],
});

Packer.toBuffer(doc).then(buf => { fs.writeFileSync(OUT, buf); console.log('écrit', OUT, buf.length, 'octets'); });

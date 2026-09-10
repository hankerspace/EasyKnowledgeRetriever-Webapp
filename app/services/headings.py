"""Breadcrumb headings for chunks of French legal texts (chapter > section > article / annex).

A chunk in the middle of a long article carries no hint of which article it belongs to; the
library prepends a chunk's `heading` to the text it embeds and shows it in the LLM context.

Backfill an index ingested before headings existed (re-embeds the chunks, keeps the graph):
    python -m app.services.headings
"""
import asyncio
import re
from typing import Dict, List

_TITLE = r"[ \t]*(?:\n\s*|[ \t]+)([^\n]{2,160})"
CHAPTER = re.compile(r"(?:^|\n)\s*CHAPITRE\s+([IVXL]+)" + _TITLE)
SECTION = re.compile(r"(?:^|\n)\s*Section\s+(\d+)" + _TITLE)
ARTICLE = re.compile(r"(?:^|\n)\s*Article\s+(\d+|premier)" + _TITLE)
ANNEX = re.compile(r"(?:^|\n)\s*ANNEXE\s+([IVXL]+)[ \t]*\n?\s*([^\n]{0,160})")
_ACRONYMS = re.compile(r"\b(ia|ue|pme|ce|tfue)\b")


def _title(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip(" .")
    if text.isupper():  # "SYSTÈMES D'IA À HAUT RISQUE" -> "Systèmes d'IA à haut risque"
        text = _ACRONYMS.sub(lambda m: m.group(1).upper(), text[:1] + text[1:].lower())
    return text


def derive_headings(contents: List[str]) -> List[str]:
    """Heading of each chunk, given the chunks' contents in document order.

    A chunk takes the headings it opens with; otherwise it inherits the running ones
    (continuation of an article, annex, recitals before the first article).
    ponytail: tuned on the French AI Act layout (CHAPITRE / Section / Article / ANNEXE).
    """
    chapter = section = None
    place = "Considérants"
    headings = []
    for text in contents:
        events = sorted(
            [(m.start(), "chapter", m) for m in CHAPTER.finditer(text)]
            + [(m.start(), "section", m) for m in SECTION.finditer(text)]
            + [(m.start(), "article", m) for m in ARTICLE.finditer(text)]
            + [(m.start(), "annex", m) for m in ANNEX.finditer(text)],
            key=lambda e: e[0],
        )
        lead = len(text) - len(text.lstrip())

        def apply(kind, m):
            nonlocal chapter, section, place
            if kind == "chapter":
                chapter, section = f"Chapitre {m.group(1)} — {_title(m.group(2))}", None
            elif kind == "section":
                section = f"Section {m.group(1)} — {_title(m.group(2))}"
            elif kind == "article":
                number = "1" if m.group(1) == "premier" else m.group(1)
                place = f"Article {number} — {_title(m.group(2))}"
            else:
                chapter = section = None
                place = f"Annexe {m.group(1)}" + (f" — {_title(m.group(2))}" if m.group(2).strip() else "")

        opening = [e for e in events if e[0] <= lead]
        for _, kind, m in opening:
            apply(kind, m)
        crumb = " > ".join(x for x in (chapter, section, place) if x)
        for _, kind, m in events[len(opening):]:
            apply(kind, m)
        # A chunk that starts in one article/annex and opens the next one mid-way must be findable by both:
        # "Annexe II ; puis Annexe III — Systèmes d'IA à haut risque ..."
        if place and place not in crumb:
            crumb = f"{crumb} ; puis {place}"
        headings.append(crumb)
    return headings


def add_headings(chunks: List[Dict]) -> List[Dict]:
    """Set `heading` on chunk dicts returned by the chunking function (document order)."""
    for chunk, heading in zip(chunks, derive_headings([c.get("content", "") for c in chunks])):
        chunk["heading"] = heading
    return chunks


async def backfill(working_dir: str) -> int:
    """Add headings to an existing index and re-embed its chunks. Returns the number of chunks."""
    import json
    import os
    from app.config import settings
    from app.state import RAGState

    with open(os.path.join(working_dir, "kv_store_text_chunks.json"), encoding="utf-8") as f:
        stored = json.load(f)
    state = RAGState()
    state.configure_from_settings(settings)
    await state.initialize(working_dir)
    rag = state.rag
    by_doc: Dict[str, List[str]] = {}
    for chunk_id, chunk in stored.items():
        by_doc.setdefault(chunk.get("full_doc_id", ""), []).append(chunk_id)
    updated = {}
    for ids in by_doc.values():
        ids.sort(key=lambda i: stored[i].get("chunk_order_index", 0))
        records = await rag.text_chunks.get_by_ids(ids)
        for chunk_id, record, heading in zip(ids, records, derive_headings([stored[i]["content"] for i in ids])):
            if record:
                updated[chunk_id] = {**record, "heading": heading}
    await rag.text_chunks.upsert(updated)
    await rag.chunks_vdb.upsert(updated)
    # upsert only changes the in-memory stores; ingestion writes them with index_done_callback
    await rag.text_chunks.index_done_callback()
    await rag.chunks_vdb.index_done_callback()
    await state.finalize()
    return len(updated)


if __name__ == "__main__":
    from app.config import settings

    print(f"{asyncio.run(backfill(settings.working_dir))} chunks updated")

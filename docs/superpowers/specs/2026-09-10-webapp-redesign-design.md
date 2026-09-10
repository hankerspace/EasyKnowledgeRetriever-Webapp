# Webapp redesign: streamed answers, per-passage sources, ingestion visibility

Date: 2026-09-10. Scope: `webapp/` only (backend `app/`, frontend `frontend/`, `nginx.conf`).

## Goals

1. Professional, coherent UI built on shadcn/ui (Vite + React + Tailwind), light and dark.
2. Sources (document + page) displayed next to each passage of the answer.
3. Verbatim of the cited chunk(s) reachable from any citation.
4. Ingestion visibility: progress, current file, list of ingested documents with status.
5. Streamed answers with visible generation progress (retrieval stats, elapsed time, tokens).

## Backend

### `POST /query/stream` (new)

Server-Sent Events (`text/event-stream`). Body: same `QueryRequest`. Events, in order:

| event     | data                                                                                  |
|-----------|---------------------------------------------------------------------------------------|
| `status`  | `{"stage": "retrieving"}` sent immediately; `{"stage": "generating"}` once retrieval is done |
| `context` | `{"chunks": [Chunk], "references": [Reference], "entities": n, "relationships": n, "metadata": {...}}` sent before the first token |
| `token`   | `{"text": "..."}` repeated                                                             |
| `done`    | `{"content": full text, "system_prompt", "user_prompt", "metadata"}`                  |
| `error`   | `{"message": "..."}` then the stream closes                                            |

Implementation: `QueryParam(stream=True)`, `rag.aquery(...)`, iterate `result.response_iterator`. If the library returns a non-streaming result anyway, emit the whole content as one `token`. Chunk payload: `chunk_id, reference_id, file_path, page_start, page_end, content`. Reference payload: `reference_id, file_path`.

### `POST /query` (existing)

Unchanged contract, plus `answer.chunks` and `answer.references` are now populated from the library result (they were dropped).

### `GET /rag/documents` (new)

Reads `rag_state.rag.doc_status.get_docs_paginated(page_size=200)` and returns
`{"total": n, "documents": [{"id", "file_path", "status", "chunks_count", "content_length", "created_at", "updated_at", "error_msg"}]}`.
Returns `{"total": 0, "documents": []}` with a `message` when the RAG is not initialized (never a 400: the page must render during startup).

### nginx

`location /query` already has `proxy_buffering off`; add `proxy_cache off` and `X-Accel-Buffering: no` on the stream response from FastAPI. No other change.

## Frontend

Stack: Vite, React 18, Tailwind 3, shadcn/ui components copied into `src/components/ui/` (JSX, `components.json` with `tsx: false`), `next-themes`-free dark mode via a `class` toggle stored in `localStorage`. Fonts: Inter via system stack fallback (no external fetch). Existing deps kept: react-markdown, remark-gfm, lucide-react, sonner, react-force-graph-2d, axios (for non-stream calls); streaming uses `fetch` + `ReadableStream`.

### Shell

shadcn `Sidebar` (collapsible to icons) with three entries: Assistant (`/chat`), Documents (`/documents`), Graphe (`/graph`). Header: page title, ingestion status pill (idle / running x/y / failed), theme toggle. `/` redirects to `/chat`.

### Chat page

- Conversation in memory; previous turns are sent as `conversation_history`.
- User message: right-aligned bubble. Assistant message: full-width card.
- **Progress stepper** at the top of an in-flight assistant card: Recherche (spinner → "n entités · n relations · n extraits") → Génération (elapsed seconds, token count). Collapses to a one-line summary when done.
- **Answer body**: markdown rendered block by block. The `### References` tail is parsed out (`[n] Title (Page p)` lines). Each top-level block (paragraph, list item, heading, blockquote) is rendered in a two-column row: text left, **source rail** right listing the unique `(reference, page)` pairs cited in that block as compact chips `Doc title · p. 12`. Inline `[n, page p]` / `[n]` markers become small numbered badges.
- **Verbatim sheet**: clicking a badge or a rail chip opens a shadcn `Sheet` listing the chunks whose `reference_id` matches (and whose page range contains the cited page when a page is given; falls back to all chunks of that reference). Each chunk shows file name, page range, verbatim text, copy button.
- Footer of the card: "Sources" summary (all references with chunk counts), "Détails techniques" collapsible (prompts, metadata), copy answer.
- Errors: `error` event or fetch failure → destructive alert inside the card, toast.
- Input: textarea with Enter to send, Shift+Enter newline, disabled while streaming, "Stop" button aborts the fetch.

### Documents page

- Polls `/rag/ingest/status` every 2 s while `status` is `scanning|running`, else every 15 s.
- Header card: progress bar `ingested/total`, current file, status badge, message, preflight error alert, "Relancer l'ingestion" button (POST `/rag/ingest`, disabled while running, 409 shown as toast).
- Errors list (file + reason).
- Documents table from `/rag/documents`: file name, status badge, chunks, size, updated at, error tooltip. Refreshed with the same poll.

### Graph page

Existing behaviour, re-skinned with shadcn `Card`, `Input`, `Button`, and theme-aware colours.

### Citation parsing (`src/lib/citations.js`, plain JS, unit-tested with `node --test`)

- `splitReferences(markdown)` → `{ body, references: [{id, title, page}] }`.
- `parseCitations(text)` → list of `{id, page}` from `[1]`, `[1, page 2]`, `[1, p. 2]`, `[1, 2]`, `[1, page 2; 3, page 4]`.
- `chunksFor(chunks, id, page)` → matching chunks as described above.

## Error handling

- Stream aborted by the user: partial text kept, marked "interrompu".
- Backend exception mid-stream: `error` event, HTTP status stays 200 (headers already sent).
- RAG not initialized: `/query/stream` returns 400 JSON before streaming; the chat shows the startup error from `/health` and disables input.

## Testing

- `test_api_smoke.py`: `/rag/documents` returns the empty shape when RAG is down; `/query/stream` returns 400 when RAG is down.
- `frontend/src/lib/citations.test.js` under `node --test`.
- `npm run build` green; manual browser walkthrough of the three pages against the running backend.

# Webapp Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a shadcn/ui webapp with streamed answers, per-passage sources with chunk verbatims, and an ingestion/documents view.

**Architecture:** FastAPI gains an SSE endpoint (`/query/stream`) and a documents listing (`/rag/documents`); the React frontend is rebuilt on shadcn/ui with three pages (Chat, Documents, Graph) and a pure-JS citation parser.

**Tech Stack:** FastAPI, easy-knowledge-retriever >= 1.3.0, Vite 5, React 18, Tailwind 3, shadcn/ui (JSX), react-markdown, lucide-react, sonner.

**Spec:** `docs/superpowers/specs/2026-09-10-webapp-redesign-design.md`

## Global Constraints

- Library floor: `easy-knowledge-retriever>=1.3.0,<2.0`. No new Python deps.
- Frontend: no external font/CDN fetches; everything bundled by Vite.
- UI copy in French. Existing `window.env.APP_TITLE/APP_SUBTITLE` keep working.
- `python test_api_smoke.py` and `npm run build` must stay green; CI unchanged.

## File map

Backend
- Modify `app/routers/query.py`: `_serialize_result()` helper, populate `chunks`/`references`, add `POST /query/stream`.
- Modify `app/routers/rag.py`: add `GET /rag/documents`.
- Modify `test_api_smoke.py`: two new tests.

Frontend (`frontend/`)
- `components.json`, `tailwind.config.js`, `src/index.css`: shadcn theme tokens, dark mode `class`.
- `src/components/ui/*.jsx`: shadcn primitives used (button, card, badge, input, textarea, sheet, tooltip, progress, table, separator, scroll-area, collapsible, alert, skeleton, sidebar, sonner wrapper).
- `src/components/AppShell.jsx`: sidebar + header + theme toggle + ingest pill.
- `src/lib/api.js`: axios instance + `streamQuery(body, handlers, signal)` + `getIngestStatus/getDocuments/triggerIngest`.
- `src/lib/citations.js` + `src/lib/citations.test.js`: parser (node --test).
- `src/pages/ChatPage.jsx`, `src/components/chat/{AnswerCard,ProgressStepper,SourceRail,ChunkSheet,Composer}.jsx`.
- `src/pages/DocumentsPage.jsx`.
- `src/pages/GraphPage.jsx`: reskin only.
- `src/App.jsx`, `src/main.jsx`: routes, ThemeProvider.
- Delete `src/components/Layout.jsx`, `src/pages/QueryPage.jsx`.

---

### Task 1: Backend serialization + `/query/stream` + `/rag/documents`
- [ ] Add tests to `test_api_smoke.py`: `/rag/documents` → 200 `{total:0, documents:[]}` when RAG down; `/query/stream` → 400 when RAG down.
- [ ] Run `python test_api_smoke.py` → fails.
- [ ] Implement `_serialize_result`, `/query/stream` (SSE per spec), populate chunks/references in `/query`; implement `/rag/documents`.
- [ ] Run smoke → passes. Commit.

### Task 2: Citation parser
- [ ] Write `src/lib/citations.test.js` (splitReferences, parseCitations, chunksFor).
- [ ] `node --test src/lib/citations.test.js` → fails.
- [ ] Implement `src/lib/citations.js`. Test passes. Commit.

### Task 3: shadcn foundation + shell
- [ ] Install deps (`@radix-ui/*` needed by chosen primitives, `class-variance-authority`, `tailwindcss-animate`), write theme CSS + tailwind config, ui primitives, AppShell, routes.
- [ ] `npm run build` green. Commit.

### Task 4: Chat page (streaming, stepper, source rail, chunk sheet)
- [ ] `streamQuery` in api.js; Chat components; wire progress + citations.
- [ ] Build green; browser check against local backend. Commit.

### Task 5: Documents page + Graph reskin
- [ ] DocumentsPage with polling, progress, table, re-ingest.
- [ ] GraphPage reskin. Build green; browser check. Commit.

### Task 6: README + CI sanity
- [ ] Document `/query/stream` and `/rag/documents` in README. Run smoke + build. Commit.

# Orchestration Run: Langfuse RAG Feedback Self-Correction Loop

**Branch**: orchestrator/bharath/langfuse-rag-feedback-loop-20260228-1920
**Developer**: bharath
**Started**: 2026-02-28 19:20
**Duration**: ~35 min (estimated)

## Tool Stack
ultrathink,c7,seq,think-hard
External SDK integration (Langfuse via c7) + architectural feedback loop design (ultrathink) + deep sequential reasoning for self-correction pipeline (seq) + performance tracing analysis (think-hard)

## Phases
- Phase 1 — Plan: ✅ SRC validated (88%→95% with gap notes), approved
- Phase 2 — Craft: ✅ 2 commits, 19 files, 2,586 insertions
- Phase 3 — Test: ✅ 22/22 unit tests pass, TypeScript clean, all imports valid
- Phase 4 — Review: ✅ 3 critical + 5 high/med/low fixes applied
- Phase 5 — Ship: ✅ Ready for push

## Commits
1475903 orchestrator(review): fix critical + high review findings
5aa42b3 orchestrator(craft): Langfuse RAG feedback self-correction loop

## Files Changed
19 files changed, 2,586 insertions(+), 4 deletions(-)

## New Files
- dbnotebook/core/observability/langfuse_client.py
- dbnotebook/api/routes/feedback.py
- dbnotebook/core/services/feedback_service.py
- dbnotebook/core/services/feedback_analyzer_service.py
- dbnotebook/core/services/feedback_analyzer_worker.py
- dbnotebook/core/services/parameter_optimizer_service.py
- alembic/versions/add_rag_feedback_tables.py
- frontend/src/components/Chat/FeedbackWidget.tsx

## New Dependencies
- langfuse>=2.0.0

## New Env Vars
- LANGFUSE_ENABLED, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_HOST
- FEEDBACK_ANALYZER_ENABLED, FEEDBACK_ANALYZER_INTERVAL

## Post-Deploy Steps
1. pip install langfuse (or rebuild Docker image)
2. alembic upgrade head (adds 4 new tables)
3. Set LANGFUSE_* env vars from Langfuse dashboard
4. Set LANGFUSE_ENABLED=true, FEEDBACK_ANALYZER_ENABLED=true
5. Restart app — worker starts automatically

---

## Follow-up Fix Session — 2026-02-28 (continuation)

**Commit**: 195c0fa fix(rag): fix adaptive top_k flowing through full retrieval pipeline

### Problem
After the feedback loop wrote `top_k=17` to `rag_adaptive_settings` for the Daaji notebook,
the streaming endpoint still returned only ~5-6 chunks. `similarity_top_k=17` was applied to
the retriever's candidate fetch, but `TwoStageRetriever._retrieve()` had a hidden second
reranker that silently capped output at `top_k_rerank=10` (the global default).

### Root Cause
Two-stage reranking pipeline in `LocalRetriever`:
1. `TwoStageRetriever._retrieve()` → internal reranker with `top_n=_setting.retriever.top_k_rerank=10` ← bottleneck
2. `RetrievalService._apply_reranking()` → external reranker (correct, already used adaptive top_k)

Setting `similarity_top_k=17` increased candidate fetch but chunks were capped to 10 before
leaving `fast_retrieve`, resulting in ~5 final chunks after RAPTOR competition.

### Fix
One line added to adaptive block in `dbnotebook/api/routes/chat_v2.py`:
```python
_r._setting.retriever.top_k_rerank = new_top_k  # was missing — the hidden cap
```
`_r._setting` is the global `RAGSettings` singleton (mutable Pydantic, `@lru_cache`),
so the assignment affects the next `TwoStageRetriever` built after `_retriever_cache.clear()`.

### Verification
```
similarity_top_k=17, top_k_rerank=17 applied for notebook 62fbdf19...
Retrieval: 17 chunks, 5 RAPTOR summaries, strategy=raptor_aware, reranker=True, time=11425ms
```

### Note
Daaji chakra coverage (all 7 chakras in one response) accepted as LLM generation outlier,
not a retrieval issue. Retrieval is now correct at 17 chunks.

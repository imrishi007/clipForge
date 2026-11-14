# Decisions

- 2026-11-13: Empty repository inspected; all supplied docs and three PNG references read. Preserve reference assets as guidance only.
- Next App Router in repository root; Python API under apps/api. This keeps Windows npm commands simple.
- SQLite and sequential local-worker mode avoid Docker requirements. Jobs persist; interrupted jobs fail on restart with retry available. Redis/Celery production adapter remains a future option unless delivered and verified.
- Browser metadata uses IndexedDB for offline Stage 1. Backend-owned records use API methods. Media blobs are never stored in localStorage.
- Single-source clips are independently rendered; no claim of full multitrack compositing.

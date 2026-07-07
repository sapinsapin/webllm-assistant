# CLAUDE.md — webllm-assistant ("Can I AI?")

Guidance for Claude Code when working in this repository.

## What this app is

A browser-based LLM benchmarking and chat app ("Can I AI?"). Users load small LLMs
**directly in their browser** (no inference server), run a benchmark/eval suite, and
publish results to a community dashboard backed by Supabase. There is also a cloud chat
backed by a private OpenAI-compatible inference bridge, called through a Supabase edge
function.

## Tech stack

- **Frontend**: Vite + React 18 + TypeScript, Tailwind + shadcn/ui (Radix), react-router,
  TanStack React Query, sonner + shadcn toast for notifications.
- **In-browser inference** (three engines, see `src/lib/inference/`):
  - `mediapipe` — `@mediapipe/tasks-genai`, WebGPU, Gemma `.task`/`.litertlm` models.
  - `webllm` — `@mlc-ai/web-llm`, WebGPU, MLC model IDs (Llama, Phi, SmolLM2).
  - `onnx` — `@huggingface/transformers` WASM, works everywhere incl. iOS Safari.
- **Backend**: Supabase (Postgres + RLS, anon key in client) and Deno edge functions in
  `supabase/functions/`:
  - `apollo-chat` — streams SSE chat from the private inference bridge (system prompt +
    per-IP token quota live here, **never in the client**).
  - `eval-judge` — LLM-as-judge scoring for the eval suite; returns structured JSON.
  - `get-hf-token` — hands the server HF token to the client for gated model downloads.
  - `mcp` — public MCP server exposing the benchmark suite to external agents.
- **Service worker**: `public/model-cache-sw.js` injects HF auth headers on model fetches.

## Commands

```sh
npm run dev        # Vite dev server (port 8080)
npm test           # vitest run (jsdom, setup in src/test/setup.ts)
npm run test:watch
npm run lint       # eslint
npm run build      # production build — must pass before pushing
```

Edge functions are deployed by Supabase (config in `supabase/config.toml`); they are
plain Deno and are NOT covered by vitest. Keep logic there small and pure-testable where
possible.

## Architecture rules

### Engine selection & fallback (the core invariant)

- `detectCapabilities()` (`src/lib/inference/detect.ts`) probes WebGPU and ranks engines
  by priority: mediapipe (1) → webllm (2) → onnx (3, always available via WASM).
- `LlmInferenceProvider` (`src/contexts/LlmInferenceContext.tsx`) owns the single engine
  instance (`engineRef`), model status, chat messages, and all benchmark runners.
  **All model loading must go through `loadModel`** — it implements the fallback chain:
  if the requested engine fails to load, it falls down the priority list using each
  engine's default model (`getSmallestModel` in `src/lib/models.ts`) and surfaces what
  happened via `statusMessage` + toast. Never bypass this by instantiating engines in
  components.
- Model presets are engine-specific (`src/lib/models.ts`). A MediaPipe URL cannot be fed
  to WebLLM — when falling back across engines you must also swap the model.

### Error-handling policy: no silent failures

- Every async path visible to a user must end in one of: rendered data, a rendered
  error state, or a toast. `console.error` alone is never sufficient.
- Never render an "empty" state (e.g. "No benchmark runs yet") when the underlying fetch
  *failed* — empty and error are different states.
- Engines throw on failure; the context catches, sets `status: "error"` +
  `statusMessage`, and toasts. Benchmark runners surface per-prompt failures to the UI.
- Edge functions must return a JSON `{ error }` body with a correct HTTP status; the
  eval-judge must never fabricate scores — unjudgeable items are returned with
  `judged: false` so the client falls back to keyword scoring explicitly.

### Server data fetching

- Use **TanStack React Query** for all Supabase reads (see `CommunityBenchmarks.tsx`).
  Required: `placeholderData: keepPreviousData` for paginated views, explicit `isError`
  UI with a retry action, and query keys that include all inputs (page, filters).
  Do not hand-roll `useEffect` + `setState` fetching — it races on pagination.
- Writes go directly through the supabase client and must toast on error.

### Prompt & AI-workflow hardening

- System prompts live server-side only (`apollo-chat`, `eval-judge`). They must:
  wrap untrusted content in explicit delimiters, instruct the model that user/model
  content is data (not instructions), and never be echoed back to the client.
- Any LLM output that is parsed programmatically (judge scores, structured extraction)
  follows the **validate → retry → explicit-fallback** loop: strict JSON contract in
  the prompt, schema validation of the response, one retry with a corrective message on
  failure, and an explicit non-fabricated fallback (`judged: false`) if it still fails.
- Rate limiting is per-IP in-memory in edge functions; buckets must be pruned (bounded
  map) — edge isolates are ephemeral so this is best-effort, real quota enforcement can
  move to Postgres if abuse appears.

### Concurrency expectations

- Target: ≥10 concurrent users. Frontend inference is per-device so it doesn't compete;
  shared surfaces are Supabase (fine at this scale; keep `benchmark_runs(created_at)`
  indexed for the dashboard) and the edge functions (stateless, auto-scaled; never add
  cross-request mutable state beyond the bounded quota map).
- In-browser: MediaPipe can only run one generation at a time — `MediaPipeEngine`
  serializes calls with an internal mutex. Keep `generateStream`/`generateFull`
  reentrant-safe in all engines.

## Conventions

- Path alias `@/` → `src/`. Components in PascalCase files; lib code lowercase.
- `src/components/ui/` is generated shadcn — don't hand-edit; add wrappers elsewhere.
- Toasts: `toast` from `@/hooks/use-toast` (shadcn) is used in benchmark flows; `sonner`
  in evals. Match whichever the surrounding file uses.
- Keep types in `src/lib/inference/types.ts` as the engine contract; all three engines
  must stay interchangeable behind `InferenceEngine`.
- DB schema changes = new SQL file in `supabase/migrations/` (timestamped name, additive
  only; RLS policies must accompany new tables).
- This project was scaffolded by Lovable; `lovable-tagger` runs in dev builds. Don't
  remove it.

## Testing strategy

- Vitest + Testing Library, jsdom. Test files live next to sources (`*.test.ts[x]`).
- Pure logic (scoring in `src/lib/evals.ts`, engine selection, SSE parsing) gets direct
  unit tests — extract logic out of components so it stays pure.
- Components with async data get state-machine tests: loading → error (with retry) →
  empty → data. Mock `@/integrations/supabase/client` at the module boundary.
- The engine fallback chain is tested by mocking `createEngine`/`detectCapabilities`
  (`vi.mock("@/lib/inference", ...)`) — never download real models in tests.
- Before pushing: `npm test && npm run lint && npm run build` must all pass.

## Gotchas

- WebLLM `formatPrompt` must serialize the FULL conversation — the MLC engine does not
  retain chat history between `chat.completions.create` calls.
- MediaPipe/Gemma output contains control tokens (`<end_of_turn>`, `<eos>`); strip them
  before display (see `cleanOutput` / `CONTROL_TOKENS`).
- Browsers cap contiguous ArrayBuffers (~2 GB): large models must use MediaPipe's
  streaming `modelAssetPath` loader (see `MAX_MODEL_ARRAYBUFFER_BYTES`).
- `navigator.gpu` exists in insecure contexts but `requestAdapter()` can still return
  null — always probe the adapter, and treat load-time WebGPU errors as fallback
  triggers, not fatal.
- Supabase anon key is public by design; anything secret goes in edge function env vars.

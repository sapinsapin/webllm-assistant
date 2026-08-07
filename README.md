# Can I AI? (`webllm-assistant`)

**Live site:** [caniaitest.com](https://www.caniaitest.com)

A browser-based LLM benchmarking and chat app. Users load small LLMs **directly in
their browser** (no inference server), chat with them, run a benchmark/eval suite,
and publish results to a community dashboard backed by Supabase. A cloud chat path
proxies to a hosted model through a Supabase Edge Function.

> Contributor guidance for AI agents lives in [CLAUDE.md](./CLAUDE.md) — it is the
> canonical statement of this repo's conventions (no silent failures, engine
> fallback, prompt hardening, concurrency limits). This README documents the
> codebase for humans.

## Quick start

```sh
npm i --legacy-peer-deps   # react-leaflet@5 peer-depends on React 19; app is on 18
npm run dev                # Vite dev server on port 8080
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with HMR |
| `npm test` | Vitest run (jsdom; setup in `src/test/setup.ts`) |
| `npm run test:watch` | Vitest watch mode |
| `npm run lint` | ESLint — kept at **0 errors**; treat it as a gate |
| `npm run build` | Production build — must pass before pushing |

## Architecture

```
Browser ──────────────────────────────────────────────────────────────┐
│  React app (Vite + TS + Tailwind/shadcn)                            │
│                                                                     │
│  LlmInferenceProvider (src/contexts/LlmInferenceContext.tsx)        │
│    owns ONE engine instance + model status + chat + benchmarks      │
│        │ loadModel() = fallback chain                               │
│        ▼                                                            │
│  InferenceEngine (src/lib/inference/types.ts)                       │
│    ├─ MediaPipeEngine   WebGPU   Gemma .task/.litertlm   (prio 1)   │
│    ├─ WebLLMEngine      WebGPU   MLC model IDs           (prio 2)   │
│    └─ OnnxEngine        WASM     works everywhere        (prio 3)   │
│                                                                     │
│  model-cache-sw.js — service worker caching model weights,          │
│                      injecting HF auth headers on gated downloads   │
└───────────────┬─────────────────────────────────────────────────────┘
                │ supabase-js (anon key, RLS)          fetch/SSE
                ▼                                          ▼
   Supabase Postgres (benchmark_runs, leads)   Supabase Edge Functions (Deno)
                                                 ├─ apollo-chat  SSE chat proxy
                                                 ├─ eval-judge   LLM-as-judge
                                                 ├─ get-hf-token gated downloads
                                                 └─ mcp          public MCP server
```

### Directory map

| Path | Purpose |
| --- | --- |
| `src/lib/inference/` | Engine contract (`types.ts`), capability detection + fallback ordering (`detect.ts`), the three engine implementations, `createEngine` factory |
| `src/contexts/LlmInferenceContext.tsx` | The single provider owning engine lifecycle, chat state, and all benchmark runners. **All model loading goes through `loadModel`** |
| `src/lib/models.ts` | Engine-specific model presets + `BENCHMARK_PROMPTS` (keep in sync with `supabase/functions/mcp/index.ts`) |
| `src/lib/evals.ts` | Accuracy eval dataset + keyword scoring (`scoreResponse`, `computeScore`, `computeHybridScore`) |
| `src/lib/sse.ts` | Incremental OpenAI-style SSE parser (chunk-split-safe) used by CloudChat |
| `src/lib/deviceInfo.ts` / `deviceFlops.ts` | Device detection and conservative TFLOPs estimation for the dashboard |
| `src/lib/handoff/` | Standalone libs: cloud→browser model handoff and P2P WebRTC serving (documented below) |
| `src/components/` | Feature components (benchmarks, chat, dashboard). `src/components/ui/` is generated shadcn — don't hand-edit |
| `supabase/functions/` | Deno edge functions; pure logic is extracted into importable modules (`eval-judge/parse.ts`, `_shared/semaphore.ts`) so Vitest can test it |
| `supabase/migrations/` | Timestamped, additive SQL migrations (RLS policies accompany new tables) |

### Engine selection & fallback (the core invariant)

`detectCapabilities()` probes WebGPU (adapter-level — `navigator.gpu` existing is
not enough) and ranks engines mediapipe → webllm → onnx. `loadModel` walks
`getFallbackChain()`: if the requested engine fails, it falls down the priority
list **swapping to that engine's own default model** (presets are engine-specific;
a MediaPipe `.task` URL cannot be fed to WebLLM), surfacing every switch via
`statusMessage` + toast. ONNX/WASM is the universal last resort, so the app never
dead-ends without an engine.

### Error-handling: no silent failures

Every user-visible async path ends in rendered data, a rendered error state, or a
toast — `console.error` alone is never sufficient. Empty and error are different
states (a failed dashboard fetch must never render "No benchmark runs yet").
Background writes (benchmark auto-submit, lead capture) toast on failure and
retry where possible.

### Edge functions

- **`apollo-chat`** — streams SSE chat from a private OpenAI-compatible inference
  bridge. Holds the system prompt (with anti-prompt-injection rules) and a
  per-IP token quota server-side; bounds concurrent upstream streams with a
  semaphore (12 + queue of 24 → 503 + `Retry-After` beyond that).
- **`eval-judge`** — LLM-as-judge scoring. Untrusted eval content is wrapped in
  `<eval>` delimiters; judge output goes through a
  **validate → retry → explicit-fallback** loop (`parse.ts`): schema-validated,
  index-window-checked, score-clamped; one corrective retry; items that still
  fail come back `judged: false` so the client falls back to keyword scoring —
  scores are never fabricated. Concurrency bounded (6 + queue of 24).
- **`get-hf-token`** — hands the server HF token to the client for gated model
  downloads (consumed by the service worker).
- **`mcp`** — public MCP server exposing the benchmark suite to external agents
  (`/.well-known/mcp.json`).

Edge functions are deployed by Supabase (`supabase functions deploy`); they are
plain Deno and are not part of the Vite build.

### Concurrency

Target ≥10 concurrent users. In-browser inference is per-device so it doesn't
compete; the shared surfaces are Supabase (indexed `benchmark_runs(created_at)`)
and the edge functions (stateless; bounded per-IP quota map + upstream
semaphores in `supabase/functions/_shared/semaphore.ts`). In the browser,
MediaPipe serializes generations with an internal mutex.

## Testing

```sh
npm test
```

Vitest + Testing Library on jsdom. Tests live next to sources (`*.test.ts[x]`)
or in `src/test/`. Coverage is deliberately failure-scenario-heavy:

- **Pure logic** — eval scoring (`evals.test.ts`, incl. invalid-regex patterns),
  engine detection/fallback ordering (`detect.test.ts`), SSE parsing across
  split chunks and malformed events (`sse.test.ts`), model preset selection
  (`models.test.ts`), TFLOPs estimation with all-null devices
  (`deviceFlops.test.ts`).
- **Edge-function logic** — judge request validation and LLM-output extraction
  (`eval-judge-parse.test.ts`: refusals, code fences, hallucinated indices,
  out-of-range scores, injection payloads), concurrency semaphore
  (`semaphore.test.ts`: shedding, queue wake-up order).
- **Components** — state-machine tests (loading → error-with-retry → empty →
  data) with Supabase/fetch mocked at the module boundary:
  `CommunityBenchmarks.test.tsx` (incl. stale-response race),
  `CloudChat.test.tsx` (streaming, network/HTTP failure, lead-capture retry),
  `LlmInferenceContext.test.tsx` (cross-engine fallback, all-engines-fail).
- **Libraries** — handoff and P2P protocol suites.

Real models are never downloaded in tests — engines are mocked at the
`createEngine`/`detectCapabilities` boundary.

Before pushing: `npm test && npm run lint && npm run build` must all pass.

## Platform support

There is no native iOS/Android/macOS app — every platform runs the same web
app, and the engine fallback chain adapts to what the platform can do:

| Platform | Engine path | Gemma 4 |
| --- | --- | --- |
| Desktop Chrome/Edge (WebGPU) | mediapipe → webllm → onnx | ✅ web-optimized `*-web.task` presets (`gemma-4-e2b`/`e4b`) |
| Android Chrome (WebGPU) | mediapipe → webllm → onnx | ✅ same presets, VRAM permitting |
| iOS Safari (no WebGPU) | onnx (WASM) | ❌ `getGemma4Model()` returns null; fallback model loads instead |
| macOS native (Apple Silicon) | — (outside this app) | ✅ MLX 4-bit builds — see [`scripts/gemma4-mlx/`](./scripts/gemma4-mlx/) |

Platform detection lives in `src/lib/deviceInfo.ts` (order matters: iPhone UAs
contain "like Mac OS X" and Android UAs contain "Linux" — tested in
`deviceInfo.test.ts`).

## Timeout policy

Timeouts exist to catch dead connections and stalls — never to cut off slow
but progressing work:

- **Cloud chat** (`CloudChat.tsx` + `src/lib/watchdog.ts`): a generous connect
  budget (25s, edge functions cold-start), then an idle watchdog (45s)
  **re-armed on every streamed chunk**. On timeout the UI shows a specific
  error with a fallback suggestion (load the on-device model). Reads race the
  abort signal so stalls are caught even where abort doesn't propagate into
  `reader.read()`.
- **Local inference** (`mediapipe-engine.ts`): the same progress-aware pattern —
  the watchdog re-arms on every partial, so only genuine stalls reject.
- **Edge functions**: upstream fetches use `AbortSignal.timeout` (60s) so a
  hung inference bridge returns a proper JSON error instead of hanging isolates.
- **Model downloads have no timeout by design** — multi-GB downloads on slow
  networks must not be killed; failures surface from the network layer itself.

## Model checkpoint caching

The app registers a service worker (`/model-cache-sw.js`) that caches downloaded
model assets (`*.bin`, `*.wasm`, `*.json`, `*.litertlm`, `*.task`, …) from common
model hosts such as Hugging Face and MLC, so models load faster on subsequent
visits. Browser cache-partitioning policies control cross-site reuse.

## Hybrid cloud-to-browser LLM handoff library

`src/lib/handoff/hybrid-llm-handoff.ts` provides smooth cloud → WebGPU handoff:
serve responses from a cloud LLM immediately, asynchronously load a browser
model, then switch to local inference without losing chat history.

```ts
import { WebLLMEngine } from "@/lib/inference";
import {
  HybridLlmHandoff,
  createCloudEndpointProvider,
  createLocalEngineProvider,
} from "@/lib/handoff";

const handoff = new HybridLlmHandoff(
  createCloudEndpointProvider({
    endpoint: "https://api.openai.com/v1/chat/completions",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-4o-mini",
  }),
  createLocalEngineProvider(new WebLLMEngine()),
  {
    localModelId: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    autoSwitchToLocal: true,
  }
);

handoff.startBackgroundLoad();           // local checkpoint downloads in background
const answer = await handoff.sendUserMessage("Explain WebGPU handoff strategy");
// Cloud answers first; once local is ready, responses switch automatically.
```

## P2P WebRTC serving protocol for WebLLM

`src/lib/handoff/p2p-llm-protocol.ts` lets one browser peer expose its local
model as a request/stream service over a WebRTC DataChannel. Message types:
`hello`, `request`, `token`, `complete`, `cancel`, `error`, `ping`/`pong`.

```ts
import { P2PLlmPeer, createRtcDataChannelTransport } from "@/lib/handoff";

// Serving peer
const serverPeer = new P2PLlmPeer({ role: "server", provider: localProvider });
serverPeer.attachTransport(createRtcDataChannelTransport(serverDataChannel));

// Requesting peer
const clientPeer = new P2PLlmPeer({ role: "client" });
clientPeer.attachTransport(createRtcDataChannelTransport(clientDataChannel));
const completion = await clientPeer.requestCompletion(
  [{ role: "user", content: "Summarize WebGPU" }],
  { onToken: (token) => {/* streamed tokens */} }
);
```

## Deployment notes

- Frontend: `npm run build` → static assets (originally scaffolded by Lovable;
  `lovable-tagger` runs in dev builds — don't remove it).
- Edge functions: `supabase functions deploy` (config in `supabase/config.toml`);
  secrets (`APOLLO_INFERENCE_API_KEY`, `HF_TOKEN`, …) live in Supabase env vars,
  never in the client. The Supabase anon key in `src/integrations/supabase/` is
  public by design and gated by RLS.
- DB changes: add a timestamped SQL file under `supabase/migrations/` (additive
  only, RLS policies included).

# Welcome to your Lovable project

## Project info


## How can I edit this code?

There are several ways of editing your application.


**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## Model checkpoint caching

This app registers a service worker (`/model-cache-sw.js`) that caches downloaded model assets (for example `*.bin`, `*.wasm`, `*.json`, `*.litertlm`, `*.task`, etc.) from common model hosts such as Hugging Face and MLC. Once downloaded, these files are reused on subsequent visits so models can load faster and avoid redownloading.

> Note: browser storage/cache partitioning policies are controlled by the browser. Reuse across unrelated sites may vary by browser/version, even when the exact same model URLs are requested.

## Hybrid cloud-to-browser LLM handoff library

This repository now includes a small TypeScript library for **smooth cloud → WebGPU/browser handoff** while model checkpoints download in the background.

- File: `src/lib/handoff/hybrid-llm-handoff.ts`
- Goal: start serving responses from a cloud LLM immediately, asynchronously load a browser WebGPU model, then switch to local inference automatically without losing chat history.

### Quick usage

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
    onLocalModelProgress: ({ progress, message }) => {
      console.log(progress, message);
    },
  }
);

// Start loading local model asynchronously (while cloud is already available)
handoff.startBackgroundLoad();

// Responses come from cloud first, then local automatically once ready
const answer = await handoff.sendUserMessage("Explain WebGPU handoff strategy");
console.log(answer);
```

### Behavior summary

1. `startBackgroundLoad()` begins local checkpoint download and initialization.
2. `sendUserMessage()` appends to shared conversation history.
3. While local is not ready, requests go to cloud provider.
4. Once local is ready, mode automatically switches to local provider.
5. Shared history is retained across providers, so handoff is seamless.

## P2P WebRTC-like serving protocol for WebLLM

This repository also includes a lightweight protocol layer for serving local WebLLM inference from one browser peer to another over a **WebRTC DataChannel**.

- Files:
  - `src/lib/handoff/p2p-llm-protocol.ts`
  - `src/lib/handoff/p2p-llm-protocol.test.ts`
- Goal: let one peer expose its local model as a request/stream service while another peer sends chat context and receives token streaming in real-time.

### Protocol message types

- `hello`: initial peer capabilities handshake.
- `request`: asks serving peer to run completion for a shared message array.
- `token`: incremental streamed output token.
- `complete`: final text response for request.
- `cancel`: client-side cancellation.
- `error`: request-level or protocol-level failure.
- `ping` / `pong`: liveness checks.

### Quick usage

```ts
import { P2PLlmPeer, createRtcDataChannelTransport } from "@/lib/handoff";

// On the serving peer: attach a local provider (for example createLocalEngineProvider(webLlmEngine))
const serverPeer = new P2PLlmPeer({ role: "server", provider: localProvider });
serverPeer.attachTransport(createRtcDataChannelTransport(serverDataChannel));

// On the requester peer:
const clientPeer = new P2PLlmPeer({ role: "client" });
clientPeer.attachTransport(createRtcDataChannelTransport(clientDataChannel));

const completion = await clientPeer.requestCompletion([{ role: "user", content: "Summarize WebGPU" }], {
  onToken: (token) => {
    // token-by-token updates
  },
});

console.log(completion);
```

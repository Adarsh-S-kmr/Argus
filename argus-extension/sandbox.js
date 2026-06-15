import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.16.1';

// Skip local model check since we are running in a browser extension context
env.allowLocalModels = false;

// Disable the explicit CacheStorage API because Chrome extension sandboxes forbid 'allow-same-origin'.
// The browser will still naturally cache the network requests (HTTP Disk Cache), so bandwidth is saved!
env.useBrowserCache = false;

// Force ONNX runtime to fetch .wasm binaries from the CDN (prevents 404 Failed to fetch locally)
env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.16.1/dist/';

// Disable ONNX Runtime Web Workers. The Sandbox Iframe already isolates the thread.
// This prevents strict CSPs from blocking 'blob:' worker creation.
env.backends.onnx.wasm.numThreads = 1;

let classifier = null;

async function initPipeline() {
  try {
    // using a lightweight sentiment model as a proxy for "emotionally manipulative framing"
    classifier = await pipeline('text-classification', 'Xenova/distilbert-base-uncased-finetuned-sst-2-english');
    window.parent.postMessage({ type: 'ARGUS_AI', status: 'ready' }, '*');
  } catch (error) {
    window.parent.postMessage({ type: 'ARGUS_AI', status: 'error', error: error.toString() }, '*');
  }
}

// Start initialization
initPipeline();

let isAnalyzing = false;
const queue = [];

async function processQueue() {
  if (isAnalyzing || queue.length === 0 || !classifier) return;
  isAnalyzing = true;
  
  const event = queue.shift();
  if (event.data.type === 'ARGUS_AI_ANALYZE') {
    const { text } = event.data;
    try {
      const result = await classifier(text.substring(0, 1000));
      window.parent.postMessage({ type: 'ARGUS_AI', status: 'complete', result }, '*');
    } catch (error) {
      window.parent.postMessage({ type: 'ARGUS_AI', status: 'error', error: error.toString() }, '*');
    }
  } else if (event.data.type === 'ARGUS_AI_ANALYZE_BATCH') {
    const { texts } = event.data;
    try {
      const results = [];
      for (const text of texts) {
        if (!text) continue;
        const result = await classifier(text.substring(0, 1000));
        results.push(result);
      }
      window.parent.postMessage({ type: 'ARGUS_AI_BATCH', status: 'complete', results, texts }, '*');
    } catch (error) {
      window.parent.postMessage({ type: 'ARGUS_AI_BATCH', status: 'error', error: error.toString() }, '*');
    }
  }
  
  isAnalyzing = false;
  processQueue();
}

window.addEventListener('message', (event) => {
  if (event.data.type === 'ARGUS_AI_ANALYZE' || event.data.type === 'ARGUS_AI_ANALYZE_BATCH') {
    queue.push(event);
    processQueue();
  }
});

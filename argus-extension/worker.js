import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.16.1';

// Skip local model check since we are running in a browser extension context
env.allowLocalModels = false;

let classifier = null;

async function initPipeline() {
  try {
    // using a lightweight sentiment model as a proxy for "emotionally manipulative framing"
    classifier = await pipeline('text-classification', 'Xenova/distilbert-base-uncased-finetuned-sst-2-english');
    postMessage({ status: 'ready' });
  } catch (error) {
    postMessage({ status: 'error', error: error.toString() });
  }
}

// Start initialization
initPipeline();

self.addEventListener('message', async (event) => {
  const { text } = event.data;
  if (!classifier) return;
  
  try {
    const result = await classifier(text);
    postMessage({ status: 'complete', result });
  } catch (error) {
    postMessage({ status: 'error', error: error.toString() });
  }
});

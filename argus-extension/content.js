let argusPanel = null;
let argusIframe = null;
let aiReady = false;

chrome.runtime.onMessage.addListener((req) => {
  if (req.type === 'INIT_ARGUS') initArgus(req.fundingData, req.domain);
});

// ── Word lists for text analysis ──
const EMOTIONAL = new Set(['shocking','horrifying','terrifying','devastating','outrageous','disgusting','incredible','unbelievable','amazing','alarming','explosive','bombshell','catastrophic','disastrous','nightmare','miracle','scandal','slamming','slams','blasts','destroys','shameful','despicable','sinister','insane','chaos','fury','furious','rage','panic','hysteria','crisis','urgent','exclusive','leaked','exposed','dangerous','deadly','lethal','toxic','evil','radical','extreme']);
const HEDGE = new Set(['allegedly','reportedly','purportedly','apparently','seemingly','possibly','perhaps','likely','unlikely','uncertain','unconfirmed','rumored','speculated','claimed','so-called']);
const OPINION = ['i think','i believe','in my opinion','arguably','clearly','obviously','undoubtedly','everyone knows','nobody can deny','the fact is','the truth is','make no mistake'];

function getArticleText() {
  const h1 = document.querySelector('h1');
  const headline = h1 ? h1.innerText.trim() : document.title;
  const paragraphs = Array.from(document.querySelectorAll('p')).map(p => p.innerText.trim()).filter(t => t.length > 20);
  const fullText = paragraphs.join('. ');
  const words = fullText.split(/\s+/);
  return { headline, textBody: words.slice(0, 500).join(' '), fullText, wordCount: words.length };
}

function extractEntities(text) {
  const entities = new Set();
  const re = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const e = m[1];
    if (e.split(' ').length <= 4 && e.length > 4) entities.add(e);
  }
  return [...entities].slice(0, 5);
}

function analyzeText(text, headline) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 15);
  const wordsArr = text.toLowerCase().split(/\s+/);
  const wc = wordsArr.length;
  const textLower = text.toLowerCase();

  // Emotional words
  const emoFound = [];
  wordsArr.forEach(w => { const c = w.replace(/[^a-z]/g, ''); if (EMOTIONAL.has(c) && !emoFound.includes(c)) emoFound.push(c); });

  // Hedge words
  const hedgeFound = [];
  HEDGE.forEach(h => { if (textLower.includes(h)) hedgeFound.push(h); });

  // Opinion markers
  const opinionFound = [];
  OPINION.forEach(o => { if (textLower.includes(o)) opinionFound.push(o); });

  // Sourcing
  const quotes = (text.match(/"[^"]{10,}"/g) || []).length;
  const attributions = (text.match(/according to|said|stated|told|confirmed by/gi) || []).length;
  const dataRefs = (text.match(/\b(study|report|data|survey|research|findings)\s+(by|from|shows?|found)/gi) || []).length;
  const sourcingScore = Math.min(100, (attributions * 20) + (quotes * 15) + (dataRefs * 25));

  // Claims with numbers/stats
  const claims = [];
  sentences.forEach(s => {
    const t = s.trim();
    if (t.length < 30) return;
    const hasNum = /\d+/.test(t);
    const hasPct = /%|percent/i.test(t);
    const hasDefinitive = /\b(confirmed|proven|all|every|none|never|always|will)\b/i.test(t);
    const hasSrc = /according to|said|stated|told/i.test(t);
    if (hasNum || hasPct || hasDefinitive) {
      claims.push({
        text: t.length > 120 ? t.substring(0, 117) + '...' : t,
        sourced: hasSrc || /"[^"]{10,}"/.test(t),
        hasData: hasNum || hasPct
      });
    }
  });

  // Headline analysis
  const headEmo = [];
  headline.toLowerCase().split(/\s+/).forEach(w => { if (EMOTIONAL.has(w.replace(/[^a-z]/g, ''))) headEmo.push(w); });
  const clickbait = /\?$|you won't believe|this is why|here's what|exposed|the truth about/i.test(headline);

  // Risk
  const risks = [];
  if (sourcingScore < 20) risks.push('Very few named sources or evidence cited');
  if (emoFound.length >= 5) risks.push('Heavy use of emotionally loaded language');
  if (opinionFound.length >= 2) risks.push('Opinion markers disguised as facts');
  if (quotes === 0 && attributions === 0) risks.push('No direct quotes or attributions found');
  if (clickbait) risks.push('Headline uses clickbait patterns');
  if (headEmo.length >= 2) risks.push('Headline is emotionally charged');

  const riskLevel = risks.length >= 3 ? 'high' : risks.length >= 1 ? 'medium' : 'low';

  return { wc, emoFound, hedgeFound, opinionFound, quotes, attributions, dataRefs, sourcingScore, claims: claims.slice(0, 5), headEmo, clickbait, risks, riskLevel };
}

// ── UI Rendering ──

function initArgus(fundingData, domain) {
  const article = getArticleText();
  if (argusPanel) argusPanel.remove();
  argusPanel = document.createElement('div');
  argusPanel.id = 'argus-panel';

  if (article.wordCount < 50) {
    argusPanel.innerHTML = `<button id="argus-panel-close" onclick="this.parentElement.remove()">×</button><h2>Argus</h2><div class="argus-error">Text too short or paywalled.</div>`;
    document.body.appendChild(argusPanel);
    return;
  }

  const a = analyzeText(article.fullText, article.headline);
  const entities = extractEntities(article.fullText);

  const icons = { high: '🔴', medium: '🟡', low: '🟢' };
  const labels = { high: 'High Caution', medium: 'Read Critically', low: 'Appears Well-Sourced' };
  const emoColor = a.emoFound.length > 4 ? '#f87171' : a.emoFound.length > 2 ? '#facc15' : '#4ade80';
  const srcColor = a.sourcingScore > 60 ? '#4ade80' : a.sourcingScore > 30 ? '#facc15' : '#f87171';

  let claimsHtml = '';
  a.claims.forEach(c => {
    const tag = c.sourced ? '<span class="argus-claim-tag sourced">Sourced</span>' : '<span class="argus-claim-tag unsourced">Unsourced</span>';
    claimsHtml += `<div class="argus-claim ${c.sourced ? 'sourced' : 'unsourced'}">${c.text} ${tag}</div>`;
  });

  let emoChips = '';
  a.emoFound.slice(0, 8).forEach(w => { emoChips += `<span class="argus-word-chip emotional">${w}</span>`; });
  let hedgeChips = '';
  a.hedgeFound.slice(0, 6).forEach(w => { hedgeChips += `<span class="argus-word-chip hedge">${w}</span>`; });

  argusPanel.innerHTML = `
    <button id="argus-panel-close" onclick="this.parentElement.remove()">×</button>
    <h2>⚡ Argus Deep Analysis</h2>
    <div class="argus-subtitle">"${article.headline.substring(0, 70)}${article.headline.length > 70 ? '...' : ''}"</div>

    <!-- VERDICT -->
    <div class="argus-verdict ${a.riskLevel}-risk">
      <div class="argus-verdict-icon">${icons[a.riskLevel]}</div>
      <div class="argus-verdict-text">
        <div class="argus-verdict-label">${labels[a.riskLevel]}</div>
        <div class="argus-verdict-reason">${a.risks[0] || 'No major red flags detected.'}</div>
      </div>
    </div>

    <!-- FACT-CHECK LOOKUP -->
    <div class="argus-section" id="argus-fc-sec">
      <div class="argus-section-header" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
        <div class="argus-section-title">✅ Fact-Check Lookup</div><span class="argus-section-toggle">▼</span>
      </div>
      <div class="argus-section-body">
        <div class="argus-loading"><div class="argus-spinner"></div><span>Searching Snopes, PolitiFact, FactCheck.org...</span></div>
      </div>
    </div>

    <!-- GLOBAL LENS -->
    <div class="argus-section" id="argus-global-sec">
      <div class="argus-section-header" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
        <div class="argus-section-title">🌍 Global Lens</div><span class="argus-section-toggle">▼</span>
      </div>
      <div class="argus-section-body">
        <div class="argus-loading"><div class="argus-spinner"></div><span>Searching global outlets...</span></div>
      </div>
    </div>

    <!-- WIKIPEDIA CROSS-REF -->
    <div class="argus-section" id="argus-wiki-sec">
      <div class="argus-section-header" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
        <div class="argus-section-title">📚 Wikipedia Cross-Reference</div><span class="argus-section-toggle">▼</span>
      </div>
      <div class="argus-section-body">
        <div class="argus-loading"><div class="argus-spinner"></div><span>Verifying entities...</span></div>
      </div>
    </div>

    <!-- LANGUAGE AUDIT -->
    <div class="argus-section">
      <div class="argus-section-header" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
        <div class="argus-section-title">🔬 Language Audit</div><span class="argus-section-toggle">▼</span>
      </div>
      <div class="argus-section-body">
        <div class="argus-stats">
          <div class="argus-stat"><div class="argus-stat-value" style="color:${emoColor}">${a.emoFound.length}</div><div class="argus-stat-label">Emotional Words</div></div>
          <div class="argus-stat"><div class="argus-stat-value" style="color:${srcColor}">${a.attributions + a.quotes}</div><div class="argus-stat-label">Sources & Quotes</div></div>
          <div class="argus-stat"><div class="argus-stat-value">${a.dataRefs}</div><div class="argus-stat-label">Data References</div></div>
          <div class="argus-stat"><div class="argus-stat-value">${a.opinionFound.length}</div><div class="argus-stat-label">Opinion Markers</div></div>
        </div>
        <div style="margin-top:10px"><div style="font-size:11px;color:#94a3b8;margin-bottom:4px">Source Quality</div><div class="argus-meter"><div class="argus-meter-fill" style="width:${a.sourcingScore}%;background:${srcColor}"></div></div></div>
        ${emoChips ? `<div style="margin-top:10px"><div style="font-size:10px;color:#94a3b8;margin-bottom:4px">LOADED WORDS:</div>${emoChips}</div>` : ''}
        ${hedgeChips ? `<div style="margin-top:8px"><div style="font-size:10px;color:#94a3b8;margin-bottom:4px">HEDGING:</div>${hedgeChips}</div>` : ''}
      </div>
    </div>

    <!-- KEY CLAIMS -->
    ${claimsHtml ? `
    <div class="argus-section">
      <div class="argus-section-header" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
        <div class="argus-section-title">📋 Key Claims</div><span class="argus-section-toggle">▼</span>
      </div>
      <div class="argus-section-body">
        <div style="font-size:11px;color:#64748b;margin-bottom:6px">Verifiable statements found:</div>
        ${claimsHtml}
      </div>
    </div>` : ''}

    <!-- AI TONE -->
    <div class="argus-section" id="argus-ai-sec">
      <div class="argus-section-header" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
        <div class="argus-section-title">🧠 AI Tone (On-Device)</div><span class="argus-section-toggle">▼</span>
      </div>
      <div class="argus-section-body">
        <div class="argus-loading"><div class="argus-spinner"></div><span>Loading AI model...</span></div>
      </div>
    </div>

    <!-- CORPORATE DNA -->
    <div class="argus-section">
      <div class="argus-section-header" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
        <div class="argus-section-title">🏢 Corporate DNA (${domain})</div><span class="argus-section-toggle">▼</span>
      </div>
      <div class="argus-section-body">
        ${fundingData ? `
          <div class="argus-trust-badge ${fundingData.trust_level === 'Verified' ? 'verified' : 'community'}">${fundingData.trust_level}</div>
          <div class="argus-data" style="margin-top:8px"><strong>Owner:</strong> ${fundingData.owner}<br/><strong>Funding:</strong> ${fundingData.funding}</div>
        ` : `<div class="argus-error">Ownership data not mapped.</div><a href="https://github.com/yourusername/argus/edit/main/argus-extension/database.json" target="_blank" class="argus-submit-btn">Submit a PR</a>`}
      </div>
    </div>
  `;

  document.body.appendChild(argusPanel);

  // ── ASYNC: Fact-Check Search ──
  chrome.runtime.sendMessage({ type: 'FACT_CHECK_SEARCH', query: article.headline }, (resp) => {
    const sec = document.querySelector('#argus-fc-sec .argus-section-body');
    if (!sec) return;
    if (chrome.runtime.lastError || !resp || !resp.results) {
      sec.innerHTML = `<div class="argus-error">Could not search fact-checkers.</div>`;
      return;
    }
    if (resp.results.length === 0) {
      sec.innerHTML = `<div class="argus-data" style="color:#94a3b8">No existing fact-checks found for this story from major fact-checking organizations.<br/><div style="font-size:11px;margin-top:4px;color:#64748b">This means the story hasn't been reviewed yet — it does NOT confirm it's true.</div></div>`;
      return;
    }
    const verdictColors = { 'true': '#4ade80', 'false': '#f87171', 'mixed': '#facc15', 'unknown': '#94a3b8' };
    const verdictEmoji = { 'true': '✅', 'false': '❌', 'mixed': '⚠️', 'unknown': '❔' };
    let html = `<div style="font-size:12px;color:#4ade80;font-weight:600;margin-bottom:8px">Found ${resp.results.length} fact-check${resp.results.length > 1 ? 's' : ''}!</div>`;
    resp.results.forEach(r => {
      html += `<div class="argus-source-card" style="border-left-color:${verdictColors[r.verdict]}">
        <div style="display:flex;align-items:center;gap:6px">
          <span>${verdictEmoji[r.verdict]}</span>
          <span class="argus-source-name">${r.source}</span>
          <span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;background:${verdictColors[r.verdict]}22;color:${verdictColors[r.verdict]}">${r.verdict.toUpperCase()}</span>
        </div>
        <div class="argus-source-headline" style="margin-top:3px">${r.title}</div>
        ${r.description ? `<div style="font-size:10px;color:#64748b;margin-top:3px">${r.description.substring(0, 150)}...</div>` : ''}
      </div>`;
    });
    sec.innerHTML = html;

    // Update verdict banner if fact-checkers found it false
    const falseCount = resp.results.filter(r => r.verdict === 'false').length;
    const trueCount = resp.results.filter(r => r.verdict === 'true').length;
    const verdict = document.querySelector('.argus-verdict');
    if (verdict && falseCount > 0) {
      verdict.className = 'argus-verdict high-risk';
      verdict.innerHTML = `<div class="argus-verdict-icon">❌</div><div class="argus-verdict-text"><div class="argus-verdict-label">Fact-Checkers Flag This as False</div><div class="argus-verdict-reason">${falseCount} fact-checking org${falseCount > 1 ? 's' : ''} rated claims in this story as FALSE.</div></div>`;
    } else if (verdict && trueCount > 0 && falseCount === 0) {
      verdict.className = 'argus-verdict low-risk';
      verdict.innerHTML = `<div class="argus-verdict-icon">✅</div><div class="argus-verdict-text"><div class="argus-verdict-label">Verified by Fact-Checkers</div><div class="argus-verdict-reason">${trueCount} fact-checking org${trueCount > 1 ? 's' : ''} confirmed claims in this story.</div></div>`;
    }
  });

  // ── ASYNC: Global Lens ──
  chrome.runtime.sendMessage({ type: 'FETCH_CONSENSUS', headline: article.headline }, (resp) => {
    const sec = document.querySelector('#argus-global-sec .argus-section-body');
    if (!sec) return;
    if (chrome.runtime.lastError || !resp) { sec.innerHTML = `<div class="argus-error">Could not reach news feeds.</div>`; return; }
    if (resp.count === 0) {
      sec.innerHTML = `<div class="argus-data" style="color:#facc15"><strong>⚠️ No other major outlets appear to cover this story.</strong><div style="font-size:11px;color:#94a3b8;margin-top:4px">Single-source stories deserve extra scrutiny.</div></div>`;
      return;
    }
    let html = `<div class="argus-data"><strong>${resp.count}</strong> other outlet${resp.count > 1 ? 's' : ''} covering this story.</div><div style="margin-top:6px;font-size:11px;color:#94a3b8">How others frame the same event:</div>`;
    (resp.items || []).forEach(item => {
      html += `<div class="argus-source-card"><div class="argus-source-name">${item.source}</div><div class="argus-source-headline">"${item.title}"</div>${item.description ? `<div style="font-size:10px;color:#64748b;margin-top:3px">${item.description}</div>` : ''}</div>`;
    });
    sec.innerHTML = html;
  });

  // ── ASYNC: Wikipedia Verification ──
  if (entities.length > 0) {
    chrome.runtime.sendMessage({ type: 'WIKI_VERIFY', entities }, (resp) => {
      const sec = document.querySelector('#argus-wiki-sec .argus-section-body');
      if (!sec) return;
      if (chrome.runtime.lastError || !resp || !resp.verified) { sec.innerHTML = `<div class="argus-error">Wikipedia check failed.</div>`; return; }
      if (resp.verified.length === 0) { sec.innerHTML = `<div class="argus-data" style="color:#94a3b8">No verifiable entities detected.</div>`; return; }
      let html = `<div style="font-size:11px;color:#64748b;margin-bottom:6px">Key people/orgs/places mentioned, verified against Wikipedia:</div>`;
      resp.verified.forEach(v => {
        if (v.exists) {
          html += `<div class="argus-source-card" style="border-left-color:#4ade80"><div class="argus-source-name">✅ ${v.entity}</div><div style="font-size:10px;color:#94a3b8">${v.description}</div><div style="font-size:10px;color:#64748b;margin-top:2px">${v.summary}</div></div>`;
        } else {
          html += `<div class="argus-source-card" style="border-left-color:#f87171"><div class="argus-source-name">❓ ${v.entity}</div><div style="font-size:10px;color:#f87171">Not found on Wikipedia. Could be misspelled, obscure, or fabricated.</div></div>`;
        }
      });
      sec.innerHTML = html;
    });
  } else {
    const sec = document.querySelector('#argus-wiki-sec .argus-section-body');
    if (sec) sec.innerHTML = `<div class="argus-data" style="color:#94a3b8">No named entities to verify.</div>`;
  }

  // ── ASYNC: AI Tone ──
  startAI(article);
}

function startAI(article) {
  const aiSec = () => document.querySelector('#argus-ai-sec .argus-section-body');
  try {
    if (!argusIframe) {
      argusIframe = document.createElement('iframe');
      argusIframe.src = chrome.runtime.getURL('sandbox.html');
      argusIframe.style.display = 'none';
      document.body.appendChild(argusIframe);
    }
    window.addEventListener('message', function handler(e) {
      if (!argusIframe || e.source !== argusIframe.contentWindow || e.data.type !== 'ARGUS_AI') return;
      const { status, result, error } = e.data;
      if (status === 'ready') {
        aiReady = true;
        const s = aiSec(); if (s) s.innerHTML = `<div class="argus-loading"><div class="argus-spinner"></div><span>Analyzing tone...</span></div>`;
        argusIframe.contentWindow.postMessage({ type: 'ARGUS_AI_ANALYZE', text: article.textBody }, '*');
      } else if (status === 'complete') {
        const label = result[0].label, score = Math.round(result[0].score * 100);
        const color = label === 'POSITIVE' ? '#4ade80' : '#f87171';
        const emoji = label === 'POSITIVE' ? '😊' : '😠';
        const exp = label === 'POSITIVE' ? 'Positive/optimistic language detected. Could be genuine or used to manufacture consent.' : 'Negative/alarming language detected. Could reflect real events or be outrage-bait.';
        const s = aiSec();
        if (s) s.innerHTML = `<div class="argus-data"><div style="font-size:15px;margin-bottom:4px">${emoji} <strong style="color:${color}">${label}</strong> <span style="color:#64748b;font-size:12px">(${score}%)</span></div><div style="font-size:11px;color:#94a3b8">${exp}</div></div>`;
        window.removeEventListener('message', handler);
      } else if (status === 'error') {
        const s = aiSec(); if (s) s.innerHTML = `<div class="argus-error">AI failed: ${error}</div>`;
        window.removeEventListener('message', handler);
      }
    });
  } catch (err) {
    const s = aiSec(); if (s) s.innerHTML = `<div class="argus-error">Could not start AI.</div>`;
  }
}

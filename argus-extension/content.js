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

// ── Helpers ──

function sectionToggle() {
  return `onclick="const b=this.nextElementSibling;b.style.display=b.style.display==='none'?'block':'none';this.querySelector('.argus-section-toggle').textContent=b.style.display==='none'?'▸':'▾'"`;
}

function makeSection(icon, iconClass, title, badge, bodyHtml, id) {
  return `<div class="argus-section"${id ? ` id="${id}"` : ''}>
    <div class="argus-section-header" ${sectionToggle()}>
      <div class="argus-section-left">
        <div class="argus-section-icon ${iconClass}">${icon}</div>
        <div class="argus-section-title">${title}</div>
        ${badge ? `<div class="argus-section-badge">${badge}</div>` : ''}
      </div>
      <span class="argus-section-toggle">▾</span>
    </div>
    <div class="argus-section-body">${bodyHtml}</div>
  </div>`;
}

// ── UI Rendering ──

function initArgus(fundingData, domain) {
  const article = getArticleText();
  if (argusPanel) argusPanel.remove();
  argusPanel = document.createElement('div');
  argusPanel.id = 'argus-panel';

  if (article.wordCount < 50) {
    argusPanel.innerHTML = `
      <div class="argus-header">
        <div class="argus-brand"><div class="argus-logo">A</div><div class="argus-brand-text"><div class="argus-brand-name">ARGUS</div><div class="argus-brand-tag">Intelligence</div></div></div>
        <button id="argus-panel-close" onclick="this.closest('#argus-panel').remove()">✕</button>
      </div>
      <div style="padding:24px"><div class="argus-error">Article text too short or paywalled to analyze.</div></div>`;
    document.body.appendChild(argusPanel);
    return;
  }

  const a = analyzeText(article.fullText, article.headline);
  const entities = extractEntities(article.fullText);

  // Confidence score (0-100, higher = more trustworthy)
  let confidence = Math.max(0, Math.min(100, Math.round(
    (a.sourcingScore * 0.4) +
    (Math.max(0, 40 - a.emoFound.length * 8)) +
    (a.risks.length === 0 ? 20 : Math.max(0, 20 - a.risks.length * 7))
  )));

  // Satire/Unverified Constraint: Do not trust blindly without fact checks
  if (confidence > 50) {
    confidence = 50; 
  }

  let riskClass = a.riskLevel;
  if (riskClass === 'low') {
    riskClass = 'medium'; // downgrade to medium until verified
  }

  const ringOffset = 251 - (251 * confidence / 100);

  const labels = { high: 'High Caution', medium: 'Pending Verification', low: 'Verified & Trustable' };
  const emoColor = a.emoFound.length > 4 ? 'var(--argus-red)' : a.emoFound.length > 2 ? 'var(--argus-yellow)' : 'var(--argus-green)';
  const srcColor = a.sourcingScore > 60 ? 'var(--argus-green)' : a.sourcingScore > 30 ? 'var(--argus-yellow)' : 'var(--argus-red)';

  // Claims HTML
  let claimsHtml = '';
  a.claims.forEach(c => {
    const tag = c.sourced
      ? '<span class="argus-claim-tag sourced">Sourced</span>'
      : '<span class="argus-claim-tag unsourced">Unsourced</span>';
    claimsHtml += `<div class="argus-claim ${c.sourced ? 'sourced' : 'unsourced'}">${c.text} ${tag}</div>`;
  });

  // Word chips
  let emoChips = '';
  a.emoFound.slice(0, 8).forEach(w => { emoChips += `<span class="argus-word-chip emotional">${w}</span>`; });
  let hedgeChips = '';
  a.hedgeFound.slice(0, 6).forEach(w => { hedgeChips += `<span class="argus-word-chip hedge">${w}</span>`; });

  // Risk pills
  let riskPills = '';
  a.risks.forEach(r => { riskPills += `<span class="argus-risk-pill ${riskClass}">${r}</span>`; });

  const truncHeadline = article.headline.length > 80 ? article.headline.substring(0, 77) + '...' : article.headline;

  argusPanel.innerHTML = `
    <!-- HEADER -->
    <div class="argus-header">
      <div class="argus-brand">
        <div class="argus-logo">A</div>
        <div class="argus-brand-text">
          <div class="argus-brand-name">ARGUS</div>
          <div class="argus-brand-tag">Deep Analysis</div>
        </div>
      </div>
      <button id="argus-panel-close" onclick="this.closest('#argus-panel').remove()">✕</button>
    </div>

    <!-- HEADLINE -->
    <div class="argus-headline-bar">Analyzing: <span>${truncHeadline}</span></div>

    <!-- CONFIDENCE RING + VERDICT -->
    <div class="argus-verdict-ring">
      <div class="argus-ring-wrap">
        <svg class="argus-ring-svg" viewBox="0 0 88 88">
          <circle class="argus-ring-bg" cx="44" cy="44" r="40"/>
          <circle class="argus-ring-fill ${riskClass}" cx="44" cy="44" r="40" style="stroke-dashoffset:${ringOffset}"/>
        </svg>
        <div class="argus-ring-label">
          <div class="argus-ring-score" style="color:${riskClass === 'high' ? 'var(--argus-red)' : riskClass === 'medium' ? 'var(--argus-yellow)' : 'var(--argus-green)'}">${confidence}</div>
          <div class="argus-ring-unit">Trust</div>
        </div>
      </div>
      <div class="argus-verdict-detail">
        <div class="argus-verdict-title ${riskClass}">${labels[riskClass]}</div>
        <div class="argus-verdict-desc">${a.risks[0] || 'No major red flags detected in this article.'}</div>
      </div>
    </div>

    <!-- RISK PILLS -->
    ${riskPills ? `<div class="argus-risk-pills">${riskPills}</div>` : ''}

    <!-- SECTIONS -->
    <div class="argus-content">
      ${makeSection('✓', 'argus-icon-fc', 'Fact-Check Lookup', null,
        '<div class="argus-loading"><div class="argus-spinner"></div><span>Searching Snopes, PolitiFact, FactCheck.org…</span></div>',
        'argus-fc-sec')}

      ${makeSection('◎', 'argus-icon-globe', 'Global Lens', null,
        '<div class="argus-loading"><div class="argus-spinner"></div><span>Searching global outlets…</span></div>',
        'argus-global-sec')}

      ${makeSection('W', 'argus-icon-wiki', 'Wikipedia Cross-Reference', null,
        '<div class="argus-loading"><div class="argus-spinner"></div><span>Verifying entities…</span></div>',
        'argus-wiki-sec')}

      ${makeSection('¶', 'argus-icon-lang', 'Language Audit', `${a.wc} words`, `
        <div class="argus-stats">
          <div class="argus-stat"><div class="argus-stat-value" style="color:${emoColor}">${a.emoFound.length}</div><div class="argus-stat-label">Emotional Words</div></div>
          <div class="argus-stat"><div class="argus-stat-value" style="color:${srcColor}">${a.attributions + a.quotes}</div><div class="argus-stat-label">Sources & Quotes</div></div>
          <div class="argus-stat"><div class="argus-stat-value">${a.dataRefs}</div><div class="argus-stat-label">Data References</div></div>
          <div class="argus-stat"><div class="argus-stat-value">${a.opinionFound.length}</div><div class="argus-stat-label">Opinion Markers</div></div>
        </div>
        <div class="argus-meter-wrap">
          <div class="argus-meter-header">
            <div class="argus-meter-label">Source Quality</div>
            <div class="argus-meter-value" style="color:${srcColor}">${a.sourcingScore}%</div>
          </div>
          <div class="argus-meter"><div class="argus-meter-fill" style="width:${a.sourcingScore}%;background:${srcColor}"></div></div>
        </div>
        ${emoChips ? `<div class="argus-chips-group"><div class="argus-chips-label">Loaded Words</div>${emoChips}</div>` : ''}
        ${hedgeChips ? `<div class="argus-chips-group"><div class="argus-chips-label">Hedging</div>${hedgeChips}</div>` : ''}
      `, null)}

      ${claimsHtml ? makeSection('◈', 'argus-icon-claim', 'Key Claims', `${a.claims.length}`,
        `<div style="font-size:10px;color:var(--argus-text-muted);margin-bottom:6px">Verifiable statements found:</div>${claimsHtml}`,
        null) : ''}

      ${makeSection('◆', 'argus-icon-ai', 'AI Tone Analysis', 'On-Device',
        '<div class="argus-loading"><div class="argus-spinner"></div><span>Initializing local AI model…</span></div>',
        'argus-ai-sec')}

      ${makeSection('⬡', 'argus-icon-corp', `Corporate DNA`, domain, `
        ${fundingData ? `
          <div class="argus-trust-badge ${fundingData.trust_level === 'Verified' ? 'verified' : 'community'}">${fundingData.trust_level === 'Verified' ? '● ' : '○ '}${fundingData.trust_level}</div>
          <div class="argus-data" style="margin-top:10px"><strong>Owner:</strong> ${fundingData.owner}<br/><strong>Funding:</strong> ${fundingData.funding}</div>
        ` : `<div class="argus-error">Ownership data not mapped for this domain.</div><a href="https://github.com/Adarsh-S-kmr/argus/edit/main/argus-extension/database.json" target="_blank" class="argus-submit-btn">Contribute Data →</a>`}
      `, null)}
    </div>

    <!-- FOOTER -->
    <div class="argus-footer">
      <span class="argus-footer-text">100% Local</span>
      <span class="argus-footer-dot"></span>
      <span class="argus-footer-text">No Data Leaves Your Browser</span>
      <span class="argus-footer-dot"></span>
      <span class="argus-footer-text">Argus v1.0</span>
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
      sec.innerHTML = `<div class="argus-data" style="color:var(--argus-text-dim)">No existing fact-checks found for this story.<div style="font-size:10px;margin-top:4px;color:var(--argus-text-muted)">This means the story hasn't been reviewed yet — it does NOT confirm it's true.</div></div>`;
      const vDesc = document.querySelector('.argus-verdict-desc');
      if (vDesc && a.risks.length < 3) {
          vDesc.textContent = 'No fact checks found. Treat as unverified or potential satire.';
      }
      return;
    }
    const vColors = { 'true': 'var(--argus-green)', 'false': 'var(--argus-red)', 'mixed': 'var(--argus-yellow)', 'unknown': 'var(--argus-text-dim)' };
    const vEmoji = { 'true': '✓', 'false': '✗', 'mixed': '!', 'unknown': '?' };
    let html = `<div style="font-size:11px;color:var(--argus-green);font-weight:700;margin-bottom:8px">Found ${resp.results.length} fact-check${resp.results.length > 1 ? 's' : ''}</div>`;
    resp.results.forEach(r => {
      html += `<div class="argus-source-card" style="border-left-color:${vColors[r.verdict]}">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="argus-source-name">${r.source}</span>
          <span class="argus-fc-verdict" style="background:${vColors[r.verdict]}15;color:${vColors[r.verdict]}">${vEmoji[r.verdict]} ${r.verdict.toUpperCase()}</span>
        </div>
        <div class="argus-source-headline" style="margin-top:3px">${r.title}</div>
        ${r.description ? `<div style="font-size:10px;color:var(--argus-text-muted);margin-top:3px">${r.description.substring(0, 150)}…</div>` : ''}
      </div>`;
    });
    sec.innerHTML = html;

    // Update verdict if fact-checkers found it false
    const falseCount = resp.results.filter(r => r.verdict === 'false').length;
    const trueCount = resp.results.filter(r => r.verdict === 'true').length;
    const vTitle = document.querySelector('.argus-verdict-title');
    const vDesc = document.querySelector('.argus-verdict-desc');
    const ring = document.querySelector('.argus-ring-fill');
    const scoreEl = document.querySelector('.argus-ring-score');
    
    if (falseCount > trueCount && vTitle && vDesc) {
      vTitle.className = 'argus-verdict-title high';
      vTitle.textContent = 'Fact-Checkers Flag This as False';
      vDesc.textContent = `${falseCount} fact-checking org${falseCount > 1 ? 's' : ''} rated claims in this story as FALSE.`;
      if (ring) { ring.className = 'argus-ring-fill high'; ring.style.strokeDashoffset = '226'; }
      if (scoreEl) { scoreEl.textContent = '10'; scoreEl.style.color = 'var(--argus-red)'; }
    } else if (trueCount > falseCount && a.sourcingScore > 30 && a.risks.length < 3 && vTitle && vDesc) {
      vTitle.className = 'argus-verdict-title low';
      vTitle.textContent = 'Verified & Trustable';
      vDesc.textContent = `${trueCount} fact-checking org${trueCount > 1 ? 's' : ''} confirmed claims in this story.`;
      if (ring) { ring.className = 'argus-ring-fill low'; ring.style.strokeDashoffset = '25'; }
      if (scoreEl) { scoreEl.textContent = '90'; scoreEl.style.color = 'var(--argus-green)'; }
    }
  });

  // ── ASYNC: Global Lens ──
  chrome.runtime.sendMessage({ type: 'FETCH_CONSENSUS', headline: article.headline }, (resp) => {
    const sec = document.querySelector('#argus-global-sec .argus-section-body');
    if (!sec) return;
    if (chrome.runtime.lastError || !resp) { sec.innerHTML = `<div class="argus-error">Could not reach news feeds.</div>`; return; }
    if (resp.count === 0) {
      sec.innerHTML = `<div class="argus-data"><strong style="color:var(--argus-yellow)">⚠ No other major outlets cover this story.</strong><div style="font-size:10px;color:var(--argus-text-muted);margin-top:4px">Single-source stories deserve extra scrutiny.</div></div>`;
      return;
    }
    let html = `<div class="argus-data"><strong>${resp.count}</strong> other outlet${resp.count > 1 ? 's' : ''} covering this story.</div><div style="margin-top:8px;font-size:10px;color:var(--argus-text-muted);margin-bottom:2px">How others frame the same event:</div>`;
    (resp.items || []).forEach(item => {
      html += `<div class="argus-source-card"><div class="argus-source-name">${item.source}</div><div class="argus-source-headline">"${item.title}"</div>${item.description ? `<div style="font-size:10px;color:var(--argus-text-muted);margin-top:3px">${item.description}</div>` : ''}</div>`;
    });
    sec.innerHTML = html;
  });

  // ── ASYNC: Wikipedia Verification ──
  if (entities.length > 0) {
    chrome.runtime.sendMessage({ type: 'WIKI_VERIFY', entities }, (resp) => {
      const sec = document.querySelector('#argus-wiki-sec .argus-section-body');
      if (!sec) return;
      if (chrome.runtime.lastError || !resp || !resp.verified) { sec.innerHTML = `<div class="argus-error">Wikipedia check failed.</div>`; return; }
      if (resp.verified.length === 0) { sec.innerHTML = `<div class="argus-data" style="color:var(--argus-text-dim)">No verifiable entities detected.</div>`; return; }
      let html = `<div style="font-size:10px;color:var(--argus-text-muted);margin-bottom:6px">Key entities verified against Wikipedia:</div>`;
      resp.verified.forEach(v => {
        if (v.exists) {
          html += `<div class="argus-source-card" style="border-left-color:var(--argus-green)"><div class="argus-source-name">● ${v.entity}</div><div style="font-size:10px;color:var(--argus-text-dim)">${v.description}</div><div style="font-size:10px;color:var(--argus-text-muted);margin-top:2px">${v.summary}</div></div>`;
        } else {
          html += `<div class="argus-source-card" style="border-left-color:var(--argus-red)"><div class="argus-source-name">✗ ${v.entity}</div><div style="font-size:10px;color:var(--argus-red)">Not found on Wikipedia. Could be misspelled, obscure, or fabricated.</div></div>`;
        }
      });
      sec.innerHTML = html;
    });
  } else {
    const sec = document.querySelector('#argus-wiki-sec .argus-section-body');
    if (sec) sec.innerHTML = `<div class="argus-data" style="color:var(--argus-text-dim)">No named entities to verify.</div>`;
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
        const s = aiSec(); if (s) s.innerHTML = `<div class="argus-loading"><div class="argus-spinner"></div><span>Analyzing tone…</span></div>`;
        argusIframe.contentWindow.postMessage({ type: 'ARGUS_AI_ANALYZE', text: article.textBody }, '*');
      } else if (status === 'complete') {
        const label = result[0].label, score = Math.round(result[0].score * 100);
        const isPositive = label === 'POSITIVE';
        const badgeClass = isPositive ? 'positive' : 'negative';
        const exp = isPositive
          ? 'Positive/optimistic language detected. Could be genuine or used to manufacture consent.'
          : 'Negative/alarming language detected. Could reflect real events or be outrage-bait.';
        const s = aiSec();
        if (s) s.innerHTML = `<div class="argus-ai-result">
          <div class="argus-ai-badge ${badgeClass}">${label} ${score}%</div>
          <div class="argus-ai-detail">${exp}</div>
        </div>`;
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

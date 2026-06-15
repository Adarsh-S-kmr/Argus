chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url) return;
  const url = new URL(tab.url);
  const domain = url.hostname.replace(/^www\./, '');

  const dbUrl = chrome.runtime.getURL('database.json');
  let db = {};
  try { const res = await fetch(dbUrl); db = await res.json(); } catch (e) {}
  const fundingData = db[domain] || null;

  await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['ui.css'] });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  setTimeout(() => {
    chrome.tabs.sendMessage(tab.id, { type: 'INIT_ARGUS', fundingData, domain });
  }, 300);
});

// ── Helper: extract significant words for overlap matching ──
function getSignificantWords(text) {
  return new Set(text.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(' ').filter(w => w.length > 3));
}

// ── Helper: decode HTML entities ──
function decodeEntities(str) {
  return str.replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '');
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // ── 1. GLOBAL LENS: other outlets covering the same story ──
  if (request.type === 'FETCH_CONSENSUS') {
    const headline = request.headline;
    const origWords = getSignificantWords(headline);

    fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(headline)}`)
      .then(r => r.text())
      .then(xml => {
        const items = [];
        let total = 0;
        const re = /<item>([\s\S]*?)<\/item>/gi;
        let m;
        while ((m = re.exec(xml)) !== null) {
          const block = m[1];
          const t = block.match(/<title>(.*?)<\/title>/i);
          const d = block.match(/<description>(.*?)<\/description>/i);
          if (!t) continue;
          let title = decodeEntities(t[1]);
          let desc = d ? decodeEntities(d[1]).substring(0, 200) : '';

          const words = getSignificantWords(title + ' ' + desc);
          let overlap = 0;
          origWords.forEach(w => { if (words.has(w)) overlap++; });
          if (overlap < 2) continue;

          total++;
          let source = 'Unknown', headlineOnly = title;
          const dash = title.lastIndexOf(' - ');
          if (dash > -1) { headlineOnly = title.substring(0, dash); source = title.substring(dash + 3); }
          if (items.length < 10) items.push({ title: headlineOnly, source, description: desc });
        }
        sendResponse({ count: total, items });
      })
      .catch(() => sendResponse({ count: 0, items: [] }));
    return true;
  }

  // ── 2. FACT-CHECK SEARCH: search for existing fact-checks ──
  if (request.type === 'FACT_CHECK_SEARCH') {
    const query = request.query;
    // Search Google News for fact-checks from known fact-checkers
    const fcQuery = `${query} fact check`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(fcQuery)}`;

    const FACT_CHECK_DOMAINS = [
      'snopes.com', 'politifact.com', 'factcheck.org', 'fullfact.org',
      'reuters.com/fact-check', 'apnews.com/ap-fact-check',
      'checkyourfact.com', 'leadstories.com', 'truthorfiction.com',
      'factcheckni.org', 'africacheck.org', 'boomlive.in',
      'altnews.in', 'vishvasnews.com', 'thequint.com/news/webqoof'
    ];

    fetch(url)
      .then(r => r.text())
      .then(xml => {
        const results = [];
        const re = /<item>([\s\S]*?)<\/item>/gi;
        let m;
        while ((m = re.exec(xml)) !== null) {
          const block = m[1];
          const t = block.match(/<title>(.*?)<\/title>/i);
          const l = block.match(/<link>(.*?)<\/link>/i);
          const d = block.match(/<description>(.*?)<\/description>/i);
          if (!t) continue;
          let title = decodeEntities(t[1]);
          let link = l ? decodeEntities(l[1]) : '';
          let desc = d ? decodeEntities(d[1]).substring(0, 300) : '';

          // Check if this is from a fact-checking organization
          let source = 'Unknown';
          const dash = title.lastIndexOf(' - ');
          if (dash > -1) { source = title.substring(dash + 3); title = title.substring(0, dash); }

          const isFactChecker = FACT_CHECK_DOMAINS.some(fc =>
            link.toLowerCase().includes(fc) || source.toLowerCase().includes(fc.split('.')[0])
          );
          const titleHasFactCheck = /fact.?check|debunk|false|misleading|true|partly|verdict|claim|hoax|fabricat/i.test(title + desc);

          if (isFactChecker || titleHasFactCheck) {
            // Try to extract verdict from title/description
            let verdict = 'unknown';
            if (/\bfalse\b|fake|fabricat|hoax|debunk|misleading|no,|incorrect/i.test(title + ' ' + desc)) verdict = 'false';
            else if (/\btrue\b|confirmed|correct|yes,|accurate|verified/i.test(title + ' ' + desc)) verdict = 'true';
            else if (/partly|partial|mixed|half|mostly|lacks context|missing context/i.test(title + ' ' + desc)) verdict = 'mixed';

            results.push({ title, source, link, description: desc, verdict, isFactChecker });
          }
          if (results.length >= 5) break;
        }
        sendResponse({ results });
      })
      .catch(() => sendResponse({ results: [] }));
    return true;
  }

  // ── 3. WIKIPEDIA VERIFICATION: verify key entities ──
  if (request.type === 'WIKI_VERIFY') {
    const entities = request.entities || [];
    const verified = [];

    // Process entities sequentially
    const processNext = (idx) => {
      if (idx >= entities.length || idx >= 3) {
        sendResponse({ verified });
        return;
      }
      const entity = entities[idx];
      const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(entity)}`;
      fetch(wikiUrl)
        .then(r => { if (!r.ok) throw new Error('Not found'); return r.json(); })
        .then(data => {
          if (data.type === 'standard' || data.type === 'disambiguation') {
            verified.push({
              entity,
              exists: true,
              summary: (data.extract || '').substring(0, 200),
              description: data.description || '',
              thumbnail: data.thumbnail ? data.thumbnail.source : null
            });
          }
          processNext(idx + 1);
        })
        .catch(() => {
          verified.push({ entity, exists: false });
          processNext(idx + 1);
        });
    };
    processNext(0);
    return true;
  }
});

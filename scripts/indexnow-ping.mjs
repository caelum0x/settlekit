#!/usr/bin/env node
/**
 * IndexNow ping for settlekit-web (Bing, Yandex, Seznam, Naver and other
 * IndexNow engines share submissions via the unified endpoint).
 *
 * settlekit-web had no robots.txt/sitemap.xml at all until 2026-10-25
 * (app/robots.ts + app/sitemap.ts), and no IndexNow key either. This is the
 * first real submission for this product.
 *
 * NOTE: settlekit.dev (the intended production domain, hardcoded as
 * metadataBase in app/layout.tsx) is NOT currently serving this app -- it
 * resolves to a stale, disconnected deployment outside this environment's
 * Cloudflare access. Submits against the real live onrender.com URL today;
 * re-run with INDEXNOW_SITE=https://settlekit.dev once the DNS/deploy
 * cutover (owner-only, see plans/settlekit.md) actually happens.
 *
 * Usage:
 *   node scripts/indexnow-ping.mjs            # submit
 *   node scripts/indexnow-ping.mjs --dry-run  # list URLs only
 */

const SITE = (process.env.INDEXNOW_SITE || 'https://settlekit-web.onrender.com').replace(/\/+$/, '');
const KEY = process.env.INDEXNOW_KEY || 'eaaa6ebf50db55f167feca83e94fe06c';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
// Confirmed on arcade.ereboslab.com (2026-10-25): the unified endpoint
// rejects large payloads in one request (1602 URLs -> HTTP 403, 500 URLs ->
// HTTP 200). Chunk conservatively.
const BATCH_SIZE = 500;
const DRY_RUN = process.argv.includes('--dry-run');

function extractUrls(xml) {
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
  return [...new Set(urls)].filter((url) => {
    try {
      return new URL(url).host === new URL(SITE).host;
    } catch {
      return false;
    }
  });
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'settlekit-indexnow-ping' } });
  if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const keyFile = await fetchText(`${SITE}/${KEY}.txt`);
  if (keyFile.trim() !== KEY) throw new Error('key file not served correctly at site root');

  const sitemapXml = await fetchText(`${SITE}/sitemap.xml`);
  const urls = extractUrls(sitemapXml);
  if (urls.length === 0) throw new Error('no URLs found in sitemap');

  console.log(`Found ${urls.length} URLs on ${new URL(SITE).host}.`);
  if (DRY_RUN) {
    console.log(urls.join('\n'));
    return;
  }

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: new URL(SITE).host,
        key: KEY,
        keyLocation: `${SITE}/${KEY}.txt`,
        urlList: batch,
      }),
    });
    console.log(`Submitted ${batch.length} URLs: HTTP ${res.status}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

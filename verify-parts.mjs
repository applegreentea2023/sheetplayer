import { chromium } from 'playwright';
const exe = '/home/user/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });

await page.goto('http://127.0.0.1:8899/index.html?demo=1', { waitUntil: 'load' });
await page.waitForFunction(() => /頁 ·/.test(document.querySelector('#status').textContent), { timeout: 120000 });
await page.click('#play');
await page.waitForFunction(() => window.__sp && window.__sp.seq, { timeout: 60000 });
await page.waitForTimeout(1200);

const parts = await page.evaluate(() => [...document.querySelectorAll('#parts .part')]
  .map(p => `${p.textContent.replace(/\s+/g, ' ').trim()}`));
console.log('聲部選擇器:', parts);
const selects = page.locator('#parts .part select');
console.log('聲部數:', await selects.count());

const snapshot = () => page.evaluate(async () => {
  const m = await window.__sp.seq.getMIDI();
  const ev = m.tracks.flatMap(t => t.events);
  const byCh = {};
  for (const e of ev) {
    if ((e.statusByte & 0xF0) === 0x90 && e.data[1] > 0) {
      const ch = e.statusByte & 0x0F;
      (byCh[ch] ||= new Set()).add(e.data[0]);
    }
  }
  return Object.fromEntries(Object.entries(byCh).map(([ch, s]) => [ch, [...s].sort((a, b) => a - b).slice(0, 6)]));
});
console.log('預設（全部鋼琴）音符 channel → 音高:', await snapshot());

// 第二個聲部改做鼓
await selects.nth(1).selectOption('drums');
await page.waitForTimeout(2000);
const after = await snapshot();
console.log('第二聲部→鼓:', after);
console.log('鼓聲部音高只應有 36/38/42:', JSON.stringify(after['9']));
await page.click('#play');
await page.waitForTimeout(1500);
console.log('播放:', await page.textContent('#time'), '| 高亮:', await page.locator('#score .hl').count(),
            '| latency(ms):', await page.evaluate(() => Math.round((window.__sp.synth.context.outputLatency || 0) * 1000)));
await page.screenshot({ path: 'shot-parts.png' });
console.log('errors:', errs.length ? errs.join(' || ') : '(none)');
await browser.close();

import { chromium } from 'playwright';
const exe = '/home/user/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));

await page.goto('http://127.0.0.1:8899/index.html?demo=1', { waitUntil: 'load' });
await page.waitForFunction(() => /頁 ·/.test(document.querySelector('#status').textContent), null, { timeout: 120000 });
await page.click('#play');
await page.waitForFunction(() => window.__sp && window.__sp.seq, null, { timeout: 60000 });

const probe = (label) => page.evaluate((label) => {
  const s = window.__sp;
  return {
    label,
    t: +s.seq.currentTime.toFixed(2),
    hr: +s.seq.currentHighResolutionTime.toFixed(2),
    paused: s.seq.paused,
    hl: document.querySelectorAll('#score .hl').length,
    btn: document.getElementById('play').textContent,
  };
}, label);

await page.waitForTimeout(2500);
console.log(await probe('播放 2.5s'));
await page.click('#play');            // 暫停
await page.waitForTimeout(400);
console.log(await probe('暫停後 0.4s'));
await page.waitForTimeout(1200);
console.log(await probe('暫停後 1.6s'));
await page.click('#play');            // 繼續
await page.waitForTimeout(600);
console.log(await probe('繼續後 0.6s'));
await page.waitForTimeout(1500);
console.log(await probe('繼續後 2.1s'));
await browser.close();

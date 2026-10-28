import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const exe = '/home/user/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });

await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => /準備好/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });

// 中文檔名 PDF（就係之前 throw 嘅情況）
await page.setInputFiles('#file', {
  name: '阿爾弗雷德 鼓譜.pdf',
  mimeType: 'application/pdf',
  buffer: readFileSync('/home/user/omr/alfred.pdf'),
});
console.log('上載後:', await page.textContent('#status'));
await page.waitForFunction(() => /頁 ·/.test(document.querySelector('#status').textContent), null, { timeout: 180000 });
console.log('認譜完:', await page.textContent('#status'));
console.log('systems:', await page.locator('#score g.system').count(), '| notes:', await page.locator('#score g.note').count());

await page.click('#play');
await page.waitForFunction(() => window.__sp && window.__sp.seq, null, { timeout: 60000 });
await page.waitForTimeout(2500);
console.log('播放:', await page.textContent('#time'), '| 高亮:', await page.locator('#score .hl').count());
await page.screenshot({ path: 'shot-alfred.png' });
console.log('errors:', errs.length ? errs.join(' || ') : '(none)');
await browser.close();

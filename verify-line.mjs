import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const exe = '/home/user/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', e => errs.push('[pageerror] ' + e.message));

await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => /準備好/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });

// 演示譜 → 撳某一行 → 應該只播該行
await page.setInputFiles('#file', { name: 'demo.musicxml', mimeType: 'application/xml', buffer: readFileSync('samples/demo.musicxml') });
await page.waitForFunction(() => /頁 ·/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
await page.click('#play');
await page.waitForFunction(() => window.__sp && window.__sp.seq, null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.click('#play');                         // 停

const ranges = await page.evaluate(() => {
  const s = window.__sp;
  const out = [];
  for (const el of document.querySelectorAll('#score g.system')) {
    const m = el.querySelector('g.measure');
    out.push(m ? Math.round(s.tk.getTimeForElement(m.id)) : null);
  }
  return out;
});
console.log('每行起始時間(ms):', ranges);

// 撳第 2 行
async function clickSystem(i) {
  const el = page.locator('#score g.system').nth(i);
  await el.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  const b = await el.boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}
await clickSystem(1);
await page.waitForTimeout(1500);
console.log('撳第 2 行後 status:', await page.textContent('#status'), '| 時間:', await page.textContent('#time'));

// 等佢播完該行（demo 每行約 8 秒）
await page.waitForTimeout(9000);
console.log('應該自動停:', await page.textContent('#time'), '| 掣:', await page.textContent('#play'),
            '| 高亮:', await page.locator('#score .hl').count());

// 撳第 3 行再試
await clickSystem(2);
await page.waitForTimeout(1200);
console.log('撳第 3 行:', await page.textContent('#status'));
console.log('errors:', errs.length ? errs.join(' || ') : '(none)');
await browser.close();

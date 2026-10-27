import { chromium } from 'playwright';
const exe = '/home/user/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('[pageerror] ' + e.message));

await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => /準備好/.test(document.querySelector('#status').textContent), { timeout: 60000 });
console.log('boot:', await page.textContent('#status'));

// 1) .mxl 上載（zip）
await page.setInputFiles('#file', 'samples/demo.mxl');
await page.waitForFunction(() => /demo\.mxl ·/.test(document.querySelector('#status').textContent), { timeout: 90000 });
console.log('mxl:', await page.textContent('#status'),
            '| notes:', await page.locator('#score g.note').count(),
            '| playDisabled:', await page.locator('#play').isDisabled());

// 2) 換 plain musicxml
await page.setInputFiles('#file', 'samples/demo.musicxml');
await page.waitForFunction(() => /demo\.musicxml ·/.test(document.querySelector('#status').textContent), { timeout: 90000 });
console.log('musicxml:', await page.textContent('#status'), '| notes:', await page.locator('#score g.note').count());

// 3) 播 → 高亮 → 截圖
await page.click('#play');
await page.waitForTimeout(3000);
console.log('play:', await page.textContent('#time'), '| hl:', await page.locator('#score .hl').count());
await page.screenshot({ path: 'shot-playing.png' });
const box = await page.locator('#score .hl').first().boundingBox();
if (box) await page.screenshot({ path: 'shot-zoom.png', clip: { x: Math.max(0, box.x - 260), y: Math.max(0, box.y - 120), width: 620, height: 260 } });
await page.click('#play');

// 4) 錯誤 handling：上載垃圾檔案
await page.setInputFiles('#file', { name: 'junk.txt', mimeType: 'text/plain', buffer: Buffer.from('hello not music') });
await page.waitForTimeout(1500);
console.log('junk →', await page.textContent('#status'));
console.log('errors:', errs.length ? errs.join(' || ') : '(none)');
await browser.close();

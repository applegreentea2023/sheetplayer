import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
const exe = '/home/user/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1200 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });

await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => /準備好/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
await page.setInputFiles('#file', { name: 'world.musicxml', mimeType: 'application/xml', buffer: readFileSync('/tmp/user4.xml') });
await page.waitForFunction(() => /世界|world|頁 ·/.test(document.querySelector('#status').textContent), null, { timeout: 120000 });
console.log('status:', await page.textContent('#status'));
console.log('systems:', await page.locator('#score g.system').count(),
            '| notes:', await page.locator('#score g.note').count(),
            '| parts:', await page.evaluate(() => document.querySelectorAll('#parts .part').length),
            '| 聲部:', await page.evaluate(() => [...document.querySelectorAll('#parts .part')].map(p => p.firstChild.textContent)));
await page.click('#play');
await page.waitForTimeout(2500);
console.log('播放:', await page.textContent('#time'), '| 高亮:', await page.locator('#score .hl').count());
await page.screenshot({ path: 'shot-world.png' });
console.log('errors:', errs.length ? errs.join(' || ') : '(none)');
await browser.close();

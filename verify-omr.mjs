import { chromium } from 'playwright';
const exe = '/home/user/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('[pageerror] ' + e.message));

await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => /準備好/.test(document.querySelector('#status').textContent), { timeout: 60000 });

// PDF 上載 → 認譜 → 出譜
const t0 = Date.now();
await page.setInputFiles('#file', '/home/user/omr/input.pdf');
console.log('上載後即時 status:', await page.textContent('#status'));
await page.waitForFunction(() => /\.pdf ·/.test(document.querySelector('#status').textContent), { timeout: 240000 });
console.log(`PDF→譜 ${((Date.now() - t0) / 1000).toFixed(1)}s |`, await page.textContent('#status'),
            '| notes:', await page.locator('#score g.note').count(),
            '| playDisabled:', await page.locator('#play').isDisabled());
// 存 MusicXML（認錯可以喺 MuseScore 改完再上載）
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dl')]);
console.log('download:', dl.suggestedFilename());
await page.click('#play');
await page.waitForTimeout(2500);
console.log('播放:', await page.textContent('#time'), '| 高亮:', await page.locator('#score .hl').count());
await page.screenshot({ path: 'shot-omr.png' });
await page.click('#play');

// 相片上載
await page.setInputFiles('#file', '/home/user/omr/photo.jpg');
await page.waitForFunction(() => /\.jpg ·/.test(document.querySelector('#status').textContent), { timeout: 240000 });
console.log('JPG:', await page.textContent('#status'), '| notes:', await page.locator('#score g.note').count());

console.log('errors:', errs.length ? errs.join(' || ').slice(0, 300) : '(none)');
await browser.close();

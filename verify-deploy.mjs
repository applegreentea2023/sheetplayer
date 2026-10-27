import { chromium } from 'playwright';
const exe = '/home/user/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const proxy = new URL(process.env.HTTPS_PROXY);          // 外網要過 WSL 嘅 proxy（要 auth）
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-gpu'] });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
  proxy: { server: `http://${proxy.host}`, username: decodeURIComponent(proxy.username), password: decodeURIComponent(proxy.password) },
});
const page = await context.newPage();
const errs = [];
page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });

const DEMO = 'https://applegreentea2023.github.io/score/?demo=1';
await page.goto(DEMO, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => /頁 ·/.test(document.querySelector('#status').textContent), null, { timeout: 120000 });
console.log('部署站 status:', await page.textContent('#status'));
console.log('systems:', await page.locator('#score g.system').count(), '| notes:', await page.locator('#score g.note').count());

await page.click('#play');
await page.waitForFunction(() => window.__sp && window.__sp.seq, null, { timeout: 60000 });
await page.waitForTimeout(2500);
console.log('播放:', await page.textContent('#time'), '| 高亮:', await page.locator('#score .hl').count());
await page.screenshot({ path: 'shot-deployed.png' });

// 網站版上載 PDF → 應出人話（冇 server）
await page.setInputFiles('#file', { name: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
await page.waitForTimeout(2500);
console.log('PDF 於網站版:', await page.textContent('#status'));
console.log('errors:', errs.length ? errs.join(' || ') : '(none)');
await browser.close();

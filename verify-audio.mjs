import { chromium } from 'playwright';
const exe = '/home/user/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));

await page.goto('http://127.0.0.1:8899/index.html?demo=1', { waitUntil: 'load' });
await page.waitForFunction(() => /頁 ·/.test(document.querySelector('#status').textContent), { timeout: 120000 });
console.log('譜出咗（未撳掣）:', await page.textContent('#status'), '| play disabled:', await page.locator('#play').isDisabled());

await page.click('#play');                       // 呢一下負責解鎖 + 起音源 + 播
await page.waitForFunction(() => window.__sp && window.__sp.synth, { timeout: 60000 });
await page.waitForTimeout(800);

const rms = await page.evaluate(async () => {
  const ctx = window.__sp.synth.context;
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  window.__sp.synth.connect(an);
  const buf = new Float32Array(an.fftSize);
  let peak = 0;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 50));
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (const v of buf) s += v * v;
    peak = Math.max(peak, Math.sqrt(s / buf.length));
  }
  return { ctxState: ctx.state, sampleRate: ctx.sampleRate, peakRms: +peak.toFixed(4) };
});
console.log('audio:', rms);
console.log('time:', await page.textContent('#time'), '| hl:', await page.locator('#score .hl').count(),
            '| btn:', await page.textContent('#play'));

await page.click('#diag');
await page.waitForTimeout(1600);
console.log('試音掣:', await page.textContent('#status'));
await browser.close();

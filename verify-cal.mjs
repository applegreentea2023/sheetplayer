import { chromium } from 'playwright';
const exe = '/home/user/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));

await page.goto('http://127.0.0.1:8899/index.html?demo=1', { waitUntil: 'load' });
await page.waitForFunction(() => /頁 ·/.test(document.querySelector('#status').textContent), null, { timeout: 120000 });
await page.evaluate(() => localStorage.removeItem('spAuto'));
await page.click('#play');
await page.waitForFunction(() => window.__sp && window.__sp.seq, null, { timeout: 60000 });

await page.waitForTimeout(6500);        // 等自動對齊跑完（1.5s 後開始、量 3 秒）
console.log('status:', await page.textContent('#status'));
console.log('實測偏移 spAuto(ms):', await page.evaluate(() => localStorage.getItem('spAuto')));

// 獨立驗證：audio 有能量嗰刻，song clock 同最近音符 onset 相差幾多
const check = await page.evaluate(async () => {
  const s = window.__sp, tk = s.tk, ctx = s.synth.context;
  const onsets = [...document.querySelectorAll('#score g.note')]
    .map(e => { try { return tk.getTimeForElement(e.id); } catch { return null; } })
    .filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  const an = ctx.createAnalyser(); an.fftSize = 256;
  s.synth.connect(an);
  const buf = new Float32Array(an.fftSize);
  const pairs = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 2000) {
    await new Promise(r => setTimeout(r, 10));
    an.getFloatTimeDomainData(buf);
    let e = 0; for (const v of buf) e += v * v;
    const rms = Math.sqrt(e / buf.length);
    if (rms > 0.01) pairs.push({ clock: s.seq.currentHighResolutionTime * 1000, rms });
  }
  s.synth.disconnect(an);
  const ds = pairs.map(({ clock }) => {
    let best = Infinity;
    for (const o of onsets) { const d = clock - o; if (d >= -20 && d < 800 && d < best) best = d; }
    return best;
  }).filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  return { n: ds.length, median: Math.round(ds[ds.length >> 1]), p25: Math.round(ds[Math.floor(ds.length * 0.25)]), p75: Math.round(ds[Math.floor(ds.length * 0.75)]) };
});
console.log('audio 能量 vs 音符 onset 嘅時差 (ms):', check);
console.log('→ 呢個 median 應該接近 spAuto');
await browser.close();

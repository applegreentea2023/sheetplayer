import { chromium } from 'playwright';
const exe = '/home/user/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));

await page.goto('http://127.0.0.1:8899/index.html?demo=1', { waitUntil: 'load' });
await page.waitForFunction(() => /頁 ·/.test(document.querySelector('#status').textContent), null, { timeout: 120000 });
await page.click('#play');
await page.waitForFunction(() => window.__sp && window.__sp.seq, null, { timeout: 60000 });
await page.waitForTimeout(500);

// 喺 worklet 輸出掛 analyser，記錄「聲音能量」同「歌曲時間」逐個 callback 對應
const res = await page.evaluate(async () => {
  const s = window.__sp, ctx = s.synth.context;
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  s.synth.connect(an);
  const buf = new Float32Array(an.fftSize);
  const samples = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 4000) {
    await new Promise(r => setTimeout(r, 10));
    an.getFloatTimeDomainData(buf);
    let e = 0;
    for (const v of buf) e += v * v;
    samples.push({ wall: (performance.now() - t0) / 1000, song: s.seq.currentHighResolutionTime, rms: Math.sqrt(e / buf.length) });
  }
  return { latency: ctx.outputLatency, base: ctx.baseLatency, samples: samples.filter((_, i) => i % 2 === 0) };
});

// 搵能量突然上升（attack）嘅位置，比較佢嘅 song 時間
const attacks = [];
for (let i = 1; i < res.samples.length; i++) {
  const a = res.samples[i - 1], b = res.samples[i];
  if (b.rms > 0.004 && b.rms > a.rms * 1.8) attacks.push({ song: +b.song.toFixed(3), wall: +b.wall.toFixed(3) });
}
console.log('outputLatency', res.latency, 'baseLatency', res.base);
console.log('偵測到 attack 數:', attacks.length);
console.log('每個 attack 嘅 (歌曲時間, wall 時間):', attacks.slice(0, 8).map(a => `${a.song}/${a.wall}`).join(' '));

// 用 timemap 對：每個 attack 最近嘅音符 onset 應該同它 song 時間一致
const onsets = JSON.parse(await page.evaluate(async () => {
  const r = await fetch('/tmp-no'); return null;
}).catch(() => null) || 'null');
console.log('(timemap 對照見下個測試)');
await browser.close();

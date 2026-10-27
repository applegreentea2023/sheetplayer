import { chromium } from 'playwright';
const exe = '/home/user/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));

await page.goto('http://127.0.0.1:8899/index.html?demo=1', { waitUntil: 'load' });
await page.waitForFunction(() => /頁 ·/.test(document.querySelector('#status').textContent), null, { timeout: 120000 });
await page.click('#play');
await page.waitForFunction(() => window.__sp && window.__sp.seq, null, { timeout: 60000 });
await page.waitForTimeout(1200);

// 高亮嘅音符 onset 應該 ≤ (現在 - 延遲)，而唔係 ≤ 現在
for (let i = 0; i < 3; i++) {
  await page.waitForTimeout(700);
  console.log(await page.evaluate(() => {
    const s = window.__sp, tk = s.tk;
    const t = s.seq.currentHighResolutionTime;
    const lag = ((s.synth.context.outputLatency || 0) + 0) * 1000;
    const ids = [...document.querySelectorAll('#score .hl')].map(e => e.id);
    const onsets = ids.map(id => { try { return tk.getTimeForElement(id); } catch { return null; } }).filter(x => x !== null);
    return {
      歌曲時間ms: Math.round(t * 1000), 延遲ms: Math.round(lag),
      聽到嘅時間ms: Math.round(t * 1000 - lag),
      高亮音符數: ids.length,
      最新onsetms: onsets.length ? Math.max(...onsets) : null,
      最舊onsetms: onsets.length ? Math.min(...onsets) : null,
    };
  }));
}
await browser.close();

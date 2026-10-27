import { chromium } from 'playwright';
const exe = '/home/user/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });

await page.goto('http://127.0.0.1:8899/index.html?demo=1', { waitUntil: 'load' });
await page.waitForFunction(() => /頁 ·/.test(document.querySelector('#status').textContent), { timeout: 120000 });
await page.click('#play');
await page.waitForFunction(() => window.__sp && window.__sp.seq, { timeout: 60000 });
await page.waitForTimeout(1500);

const layout = () => page.evaluate(() => ({
  systems: document.querySelectorAll('#score g.system').length,
  pages: document.querySelectorAll('.page').length,
}));
console.log('layout（原譜 5 個 new-system = 測量 1|5|9|13 → 4 系統）:', await layout());
console.log('預設樂器 program events:', await page.evaluate(async () => {
  const m = await window.__sp.seq.getMIDI();
  return [...new Set(m.tracks.flatMap(t => t.events).filter(e => (e.statusByte & 0xF0) === 0xC0).map(e => e.data[0]))];
}));

// 鋼琴＋鼓
await page.selectOption('#inst', 'pianoDrum');
await page.waitForTimeout(1800);
console.log('鋼琴＋鼓:', await page.evaluate(async () => {
  const m = await window.__sp.seq.getMIDI();
  const ev = m.tracks.flatMap(t => t.events);
  const notes = new Set(ev.filter(e => (e.statusByte & 0xF0) === 0x90 && e.data[1] > 0).map(e => e.statusByte & 0x0F));
  const drum = ev.filter(e => (e.statusByte & 0xF0) === 0x90 && (e.statusByte & 0x0F) === 9);
  const progs = [...new Set(ev.filter(e => (e.statusByte & 0xF0) === 0xC0).map(e => e.data[0]))];
  return { noteChannels: [...notes], drumHits: drum.length, programs: progs,
           drumPitches: [...new Set(drum.map(e => e.data[0]))].sort((a, b) => a - b) };
}));

// 有聲？（掛 analyser 讀 RMS）
await page.click('#play');
const rms = await page.evaluate(async () => {
  const ctx = window.__sp.synth.context;
  const an = ctx.createAnalyser(); an.fftSize = 2048;
  window.__sp.synth.connect(an);
  const buf = new Float32Array(an.fftSize);
  let peak = 0, low = 0;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 50));
    an.getFloatTimeDomainData(buf);
    let s = 0; for (const v of buf) s += v * v;
    peak = Math.max(peak, Math.sqrt(s / buf.length));
  }
  return { peakRms: +peak.toFixed(4), state: ctx.state };
});
console.log('播放中:', await page.textContent('#time'), '| audio:', rms);
await page.screenshot({ path: 'shot-drum.png' });

// 換返鋼琴，確認鼓唔會殘留
await page.selectOption('#inst', 'piano');
await page.waitForTimeout(1500);
console.log('返鋼琴 drum hits:', await page.evaluate(async () => {
  const m = await window.__sp.seq.getMIDI();
  return m.tracks.flatMap(t => t.events).filter(e => (e.statusByte & 0xF0) === 0x90 && (e.statusByte & 0x0F) === 9).length;
}));
console.log('errors:', errs.length ? errs.join(' || ') : '(none)');
await browser.close();

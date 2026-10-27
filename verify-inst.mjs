import { chromium } from 'playwright';
const exe = '/home/user/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push('[pageerror] ' + e.message));

await page.goto('http://127.0.0.1:8899/index.html?demo=1', { waitUntil: 'load' });
await page.waitForFunction(() => /頁 ·/.test(document.querySelector('#status').textContent), { timeout: 120000 });
await page.click('#play');                       // 解鎖音源 + 起 sequencer
await page.waitForFunction(() => window.__sp && window.__sp.seq, { timeout: 60000 });
console.log('原譜行數(system):', await page.locator('#score g.system').count(),
            '| 頁:', await page.locator('.page').count());

const progs = () => page.evaluate(async () => {
  const m = await window.__sp.seq.getMIDI();
  const out = new Set();
  for (const t of m.tracks) for (const e of t.events)
    if ((e.statusByte & 0xF0) === 0xC0) out.add(`${e.statusByte.toString(16)}:${e.data[0]}`);
  return [...out];
});
const chans = () => page.evaluate(async () => {          // MIDI 事件層面：邊個 channel 有 note / 邊個 program
  const m = await window.__sp.seq.getMIDI();
  const notes = new Set(), progs = new Set();
  for (const t of m.tracks) for (const e of t.events) {
    if ((e.statusByte & 0xF0) === 0x90 && e.data[1] > 0) notes.add(e.statusByte & 0x0F);
    if ((e.statusByte & 0xF0) === 0xC0) progs.add(e.data[0]);
  }
  return { noteChannels: [...notes], programs: [...progs] };
});

console.log('預設(鋼琴) program events:', await progs());
console.log('鋼琴:', await chans());
await page.selectOption('#inst', 'score');
await page.waitForTimeout(1200);
console.log('原譜 program events:', await progs());
await page.selectOption('#inst', 'pianoDrum');
await page.waitForTimeout(1200);
console.log('鋼琴＋鼓:', await chans(), '| 鼓 hits:',
  await page.evaluate(async () => {
    const m = await window.__sp.seq.getMIDI();
    return m.tracks.flatMap(t => t.events).filter(e => (e.statusByte & 0xF0) === 0x90 && (e.statusByte & 0x0F) === 9).length;
  }));
await page.click('#play'); await page.waitForTimeout(1500);
console.log('鼓播放:', await page.textContent('#time'), '| 發聲中 voices:',
  await page.evaluate(() => window.__sp.synth.midiChannels.reduce((n, c) => n + (c ? c.voiceCount : 0), 0)));
await page.click('#play');
await page.selectOption('#inst', 'piano');
await page.waitForTimeout(1200);
console.log('返鋼琴:', await progs());

// 播放仍然正常？
await page.click('#play');
await page.waitForTimeout(2000);
console.log('播放:', await page.textContent('#time'), '| 高亮:', await page.locator('#score .hl').count());
await page.screenshot({ path: 'shot-inst.png' });
console.log('errors:', errs.length ? errs.join(' || ').slice(0, 200) : '(none)');
await browser.close();

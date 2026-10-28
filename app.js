import createVerovioModule from './vendor/verovio-module.mjs';
import { VerovioToolkit } from './vendor/verovio.mjs';
import { WorkletSynthesizer, Sequencer } from 'spessasynth_lib';
import { unzipSync } from 'fflate';

const $ = s => document.querySelector(s);
const timeFmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

let tk, ctx, synth, seq, duration = 0, playing = false, lastIds = [], lastXml = '';
let origMidi = null;         // 樂譜原始 MIDI（BasicMIDI），切樂器時用返
let pendingMidi = null;      // 未入 sequencer 嘅 MIDI（音源未解鎖前先擺住）
let curName = '';            // 而家首歌嘅檔名（status 用）

/* 每個聲部各自揀樂器（channel → 'piano' | 'drums' | 'score'）。
   全部喺 MIDI 數據層改：channel.setDrums 會被 sequencer 送嘅 program change 蓋返，靠唔住。 */
let instMap = {};              // MIDI channel → 樂器

/* 鼓：唔可以照用音高做鼓掣（高音 = cymbal/bell = 刺耳尖叫）。
   按音區搬去 3 粒常用鼓：低音 → 大鼓 36、中音 → 小鼓 38、高音 → hi-hat 42。 */
const drumFor = p => (p < 52 ? 36 : p < 72 ? 38 : 42);

async function applyInstruments() {
  if (!seq || !origMidi) return;
  const t = seq.currentTime, wasPlaying = playing;
  if (playing) { seq.pause(); playing = false; }
  const loaded = async () => {           // loadNewSongList 會先清 midiData → duration 0，等佢返嚟
    const t0 = performance.now();
    while (!seq.duration && performance.now() - t0 < 3000) await new Promise(r => setTimeout(r, 50));
  };
  seq.loadNewSongList([origMidi]);       // 一定要由原始譜出發（唔係就會將上次嘅改動疊上去）
  await loaded();
  const m = await seq.getMIDI();         // getMIDI() 本身就係 copy
  for (const trk of m.tracks)
    for (const ev of trk.events) {
      if (ev.statusByte < 0x80 || ev.statusByte >= 0xF0) continue;
      const mode = instMap[ev.statusByte & 0x0F] || 'piano';
      const kind = ev.statusByte & 0xF0;
      if (mode === 'piano' && kind === 0xC0) ev.data[0] = 0;                 // Acoustic Grand
      if (mode === 'drums' && (kind === 0x90 || kind === 0x80)) {
        ev.data[0] = drumFor(ev.data[0]);                                    // 先按音區轉鼓
        ev.statusByte = kind | 9;                                            // 再搬去打擊 channel
      }
    }
  m.flush();                             // 改咗 channel 要重排
  seq.loadNewSongList([m]);
  await loaded();
  seq.currentTime = Math.min(t, seq.duration || 0);
  if (wasPlaying) { seq.play(); playing = true; }
  $('#play').textContent = playing ? '❚❚' : '▶';
}

/* 由 MIDI 實際用咗嘅 channel 砌返聲部清單（名跟 MIDI track name：Voice / Piano…） */
function buildParts(m) {
  const names = new Map();
  for (const trk of m.tracks) {
    const chs = new Set();
    for (const ev of trk.events)
      if ((ev.statusByte & 0xF0) === 0x90 && ev.data[1] > 0) chs.add(ev.statusByte & 0x0F);
    for (const ch of chs) if (!names.has(ch)) names.set(ch, trk.name || `聲部${ch + 1}`);
  }
  const host = $('#parts');
  host.innerHTML = '';
  for (const [ch, name] of [...names].sort((a, b) => a[0] - b[0])) {
    const wrap = document.createElement('label');
    wrap.className = 'part';
    wrap.textContent = name;
    const sel = document.createElement('select');
    sel.innerHTML = '<option value="piano">🎹 鋼琴</option><option value="drums">🥁 鼓</option>' +
                    '<option value="score">🎼 原譜</option>';
    sel.value = instMap[ch] || 'piano';
    sel.onchange = () => {
      instMap[ch] = sel.value;
      applyInstruments().catch(e => status('❌ ' + e.message));
    };
    wrap.append(sel);
    host.append(wrap);
  }
}

const status = m => { $('#status').textContent = m; };

/* ---------- 樂譜 → SVG + MIDI（Verovio） ---------- */

function unpack(buf) {                      // 壓縮 .mxl = zip
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return new TextDecoder().decode(buf);
  const files = unzipSync(buf);
  let name = Object.keys(files).find(n => /\.(musicxml|xml)$/i.test(n) && !n.startsWith('META-INF'));
  const meta = files['META-INF/container.xml'];
  if (meta) {
    const m = new TextDecoder().decode(meta).match(/full-path="([^"]+)"/);
    if (m && files[m[1]]) name = m[1];
  }
  if (!name) throw new Error('zip 入面搵唔到樂譜');
  return new TextDecoder().decode(files[name]);
}

function render() {
  // 原譜有寫開「每行由邊度斷」（MusicXML <print new-system/new-page>）就跟返，唔好自己重排
  const encoded = /<print[^>]*new-(system|page)/.test(lastXml);
  tk.setOptions({ scale: 40, pageWidth: 2100, adjustPageHeight: 1, footer: 'none', header: 'none',
                  breaks: encoded ? 'encoded' : 'auto', svgViewBox: 1 });
  tk.redoLayout();        // ❗ setOptions 之後一定要 redoLayout，唔係 breaks/pageWidth 全部靜靜咁唔生效
  const pages = tk.getPageCount();
  const host = $('#score');
  host.innerHTML = '';
  for (let p = 1; p <= pages; p++) {
    const d = document.createElement('div');
    d.className = 'page';
    d.innerHTML = tk.renderToSVG(p);
    host.appendChild(d);
  }
}

const IMG_RE = /\.(pdf|png|jpe?g|tiff?|bmp|gif)$/i;

async function loadFile(file) {
  stop();
  origMidi = null;
  calDone = false;
  status(`載入中… ${file.name}`);
  let buf = new Uint8Array(await file.arrayBuffer());
  if (IMG_RE.test(file.name)) {                       // PDF／相片 → 交 server 認譜
    status(`🔍 認譜中… ${file.name}（大約 10–60 秒，唔好閂窗）`);
    // 相對路徑：本機 serve.py 喺根目錄；擺上 GitHub Pages 就係 /<repo>/api/omr（冇呢個 endpoint）
    // header 只可以 ISO-8859-1：中文／emoji 檔名要 encode，唔係 fetch 直接 throw
    const r = await fetch('api/omr', { method: 'POST', headers: { 'X-Filename': encodeURIComponent(file.name) }, body: buf });
    if (!r.ok) {
      const txt = await r.text();
      if ([404, 405, 501].includes(r.status))
        throw new Error('呢個網站版冇認譜 server（PDF／相片只喺本機版用得）。請先用 MuseScore 開 PDF → 另存 MusicXML');
      throw new Error(`認譜失敗（${r.status}）${txt.slice(0, 200)}`);
    }
    buf = new Uint8Array(await r.arrayBuffer());
  }
  const xml = unpack(buf);
  if (tk.loadData(xml) !== 1) throw new Error('睇唔明呢份樂譜（支援 MusicXML / .mxl / MEI / ABC）');
  lastXml = xml;
  $('#dl').hidden = false;
  render();                              // 譜先出（唔使等音源，iOS 上尤其重要）
  $('#empty').hidden = true;
  pendingMidi = b64ToBytes(tk.renderToMIDI());
  curName = file.name;
  $('#play').disabled = false;           // 唔可以 disable：iOS 要靠撳呢粒掣解鎖 AudioContext
  status(`${file.name} · ${tk.getPageCount()} 頁 · ${ctx ? '載入音源…' : '撳播放開始'}`);
  if (ctx) await startPlayback();         // 已經解鎖過就即刻準備
}

/* 攞 MIDI 入 sequencer + 更新時長（音源一定要已經起好） */
async function startPlayback() {
  if (!pendingMidi) return;
  duration = 0;
  seq.loadNewSongList([{ binary: pendingMidi, fileName: 'score.mid' }]);
  seq.eventHandler.addEvent?.('midiError', e => status('❌ MIDI: ' + (e?.message || e)));
  const t0 = performance.now();
  while (!seq.duration && performance.now() - t0 < 4000) await new Promise(r => setTimeout(r, 50));
  duration = seq.duration || 0;
  origMidi = await seq.getMIDI().catch(() => null);
  if (origMidi) {
    buildParts(origMidi);                // 每個聲部一個樂器選擇
    instMap = {};                        // 新譜 → 預設全部鋼琴
    await applyInstruments();
  }
  $('#bar').disabled = !duration;
  syncUI(0);
  status(`${curName} · ${tk.getPageCount()} 頁 · ${timeFmt(duration)}`);
}

function b64ToBytes(b64) {
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/* ---------- 聲音（spessasynth + GM soundfont） ---------- */

async function ensureAudio() {
  if (seq) return;
  await audioReady();                    // iOS：ctx 一定要喺 touch 手勢內建立（見 unlockAudio）
  status('載入音源…（首次 6MB，一次過）');
  await ctx.audioWorklet.addModule('./vendor/spessasynth_processor.min.js');
  synth = new WorkletSynthesizer(ctx);
  synth.connect(ctx.destination);        // 一定要手動接！library 唔會自動接去喇叭（唔接就時間照行、完全冇聲）
  await synth.soundBankManager.addSoundBank(await (await fetch('./vendor/TimGM6mb.sf2')).arrayBuffer(), 'main');
  await synth.isReady;
  seq = new Sequencer(synth);
  seq.loopCount = 0;
}

/* ---------- 播放控制 ---------- */

async function toggle() {
  if (!seq || !duration) return;
  await Promise.race([ctx.resume(), new Promise(r => setTimeout(r, 800))]);   // iOS 有時 resume 會吊住
  if (ctx.state !== 'running') status('🔇 瀏覽器未解鎖音訊：再撳一次播放');
  if (playing) { seq.pause(); playing = false; }
  else {
    if (seq.currentTime >= duration - 0.05) seq.currentTime = 0;
    seq.play(); playing = true;
    if (!calDone) { calDone = true; setTimeout(() => autoCalibrate().catch(() => {}), 1500); }
  }
  $('#play').textContent = playing ? '❚❚' : '▶';
}

function stop() {
  if (seq) { seq.pause(); seq.currentTime = 0; }
  playing = false;
  if ($('#play')) $('#play').textContent = '▶';
  syncUI(0);
}

function seek(t) {
  if (!seq || !duration) return;
  seq.currentTime = Math.max(0, Math.min(t, duration));
  if (playing) seq.play();      // seek 後繼續播
  syncUI(seq.currentTime);
}

function syncUI(t) {
  $('#time').textContent = `${timeFmt(t)} / ${timeFmt(duration)}`;
  if (duration) $('#bar').value = Math.round(t / duration * 1000);
}

/* ---------- 跟譜高亮 ---------- */

/* 高亮要對「而家聽到嘅聲」，唔係 sequencer 播到邊。
   實測（headless Chrome）：audio 出到 analyser 嗰刻，song clock 已經行快 ~374ms，
   而 ctx.outputLatency 只報 128ms → 信 outputLatency 一定對唔上。
   所以：播放時量度（audio 包絡 vs 音符 onset 互相關），再加手動 trim。 */
let calDone = false;                                   // 每份譜校一次
let autoMs = +(localStorage.getItem('spAuto') || 0);   // 實測偏移
let calMs = +(localStorage.getItem('spCal') || 0);     // 手動微調
const audioLagMs = () => autoMs + calMs;

/* 播 3 秒，搵邊個延遲值令「音符 onset」同「實際 audio 能量」最吻合 */
async function autoCalibrate() {
  if (!ctx || !seq || !tk || !playing) return;
  const onsets = [...document.querySelectorAll('#score g.note')]
    .map(e => { try { return tk.getTimeForElement(e.id); } catch { return null; } })
    .filter(x => Number.isFinite(x));
  if (onsets.length < 8) return;
  const an = ctx.createAnalyser();
  an.fftSize = 256;
  synth.connect(an);
  const buf = new Float32Array(an.fftSize);
  const audio = [], clock = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 3000 && playing) {
    await new Promise(r => setTimeout(r, 10));
    an.getFloatTimeDomainData(buf);
    let e = 0;
    for (const v of buf) e += v * v;
    audio.push(Math.sqrt(e / buf.length));
    clock.push(seq.currentHighResolutionTime * 1000);
  }
  synth.disconnect(an);
  let best = 0, bestScore = -1;
  for (let d = 0; d <= 800; d += 10) {                  // 0–800ms，10ms 一格
    let sc = 0;
    for (let i = 0; i < audio.length; i++) {
      if (audio[i] < 0.002) continue;
      const tms = clock[i] - d;
      if (onsets.some(o => o <= tms && tms - o < 120)) sc += audio[i];   // 120ms 內有音符開始 = 有聲
      else sc -= audio[i] * 0.5;                                          // 冇音符但有聲 = 扣分
    }
    if (sc > bestScore) { bestScore = sc; best = d; }
  }
  if (bestScore > 0 && best !== autoMs) {
    autoMs = best;
    localStorage.setItem('spAuto', autoMs);
    status(`⚖ 自動對齊：${autoMs}ms`);
  }
}

function tick() {
  requestAnimationFrame(tick);
  if (!tk || !seq || !duration) return;
  const raw = playing ? seq.currentHighResolutionTime : seq.currentTime;
  if (!Number.isFinite(raw)) return;                                  // iOS 有時會畀 NaN
  const t = raw;
  // 唔可以用 seq.paused 判斷「播完」：iOS resume 之後 paused 會忽然 true，會誤判成完結 → 畫面凍結冇高亮
  if (playing && t >= duration - 0.05) { playing = false; $('#play').textContent = '▶'; }
  const lag = audioLagMs();
  const heard = playing ? Math.max(0, t - (Number.isFinite(lag) ? lag : 0) / 1000) : t;   // 對齊「聽到的」
  let els;
  try { els = tk.getElementsAtTime(Math.max(0, Math.round(heard * 1000))); } catch { return; }
  const ids = [...(els.notes || []), ...(els.chords || [])];
  if (!ids.length && !playing && lastIds.length) return;   // 暫停／播完時唔清走已經亮住嘅音（iOS 上會「消失」）
  if (ids.join() !== lastIds.join()) {
    for (const id of lastIds) document.getElementById(id)?.classList.remove('hl');
    for (const id of ids) document.getElementById(id)?.classList.add('hl');
    lastIds = ids;
    const page = document.getElementById(els.measure || '');
    if (page && playing) {
      const r = page.getBoundingClientRect();
      if (r.top < 80 || r.bottom > innerHeight - 40)
        page.closest('.page').scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  syncUI(t);
}

/* ---------- 撳譜跳去某個位 ---------- */

$('#score').addEventListener('click', e => {
  const el = e.target.closest('[id]');
  if (!el || !tk || !duration) return;
  let ms = 0;
  try { ms = tk.getTimeForElement(el.id); } catch {}
  if (ms > 0) seek(ms / 1000);
});

/* ---------- UI 接線 ---------- */

$('#play').onclick = () => {           // 唔可以 async：第一件事要同步解鎖 AudioContext（iOS Safari）
  unlockAudio();
  (async () => {
    if (!seq) {
      status('載入音源…（首次 6MB，一次過）');
      await ensureAudio();
      await startPlayback();
    }
    await toggle();
  })().catch(e => status('❌ ' + e.message));
};
$('#bar').oninput = e => seek(+e.target.value / 1000 * duration);
$('#speed').onchange = e => { if (seq) seq.playbackRate = +e.target.value; };
$('#cal').value = calMs;
$('#calv').textContent = calMs + 'ms';
$('#cal').oninput = e => {
  calMs = +e.target.value;
  $('#calv').textContent = calMs + 'ms';
  localStorage.setItem('spCal', calMs);
};
/* 試音 + 診斷：直接 synth.noteOn 彈個 chord，用 AnalyserNode 量返 RMS。
   分得清「synth 冇聲」、「AudioContext 未解鎖」、「手機靜音制／音量」三種情況。 */
$('#diag').onclick = async () => {
  try {
    unlockAudio();
    await ensureAudio();
    await ctx.resume();
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    synth.connect(an);
    [60, 64, 67].forEach(n => synth.noteOn(0, n, 100));
    const buf = new Float32Array(an.fftSize);
    let peak = 0;
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 100));
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (const v of buf) s += v * v;
      peak = Math.max(peak, Math.sqrt(s / buf.length));
    }
    [60, 64, 67].forEach(n => synth.noteOff(0, n));
    synth.disconnect(an);
    status(`🔊 ${ctx.state} · RMS ${peak.toFixed(4)} · 延遲 ${Math.round(audioLagMs())}ms · ` +
           `t=${seq ? seq.currentTime.toFixed(1) : '-'}s · 高亮 ${document.querySelectorAll('#score .hl').length} · ` +
           (peak > 0.001 ? 'synth 有輸出' : 'synth 冇輸出（同我講）'));
  } catch (e) { status('❌ 試音失敗：' + e.message); }
};
$('#dl').onclick = () => {
  const name = ($('#status').textContent.split(' · ')[0] || 'score').replace(/\.[^.]+$/, '');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lastXml], { type: 'application/xml' }));
  a.download = name + '.musicxml';
  a.click();
};
$('#file').onchange = e => e.target.files[0] && loadFile(e.target.files[0]).catch(err => status('❌ ' + err.message));
$('#demo').onclick = () => fetch('./samples/demo.musicxml')
  .then(r => r.blob()).then(b => loadFile(new File([b], 'demo.musicxml')))
  .catch(err => status('❌ ' + err.message));

let zoomW = 900;
const zoom = d => { zoomW = Math.max(420, Math.min(1600, zoomW + d)); document.querySelectorAll('.page').forEach(p => p.style.maxWidth = zoomW + 'px'); };
$('#zin').onclick = () => zoom(120);
$('#zout').onclick = () => zoom(-120);

/* iOS Safari 最惡嘅坑：AudioContext 喺任何 await 之後才 new 出嚟，就算之後 ctx.state 話 'running'，
   個 worklet 都永遠唔出聲（WebKit willBeginPlayback=false）。所以一定要喺 touch／pointerdown 手勢內同步 new。 */
let audioUnlocked = false;
function unlockAudio() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state !== 'running') ctx.resume();
  audioUnlocked = true;
}
for (const ev of ['pointerdown', 'touchend', 'keydown'])
  addEventListener(ev, unlockAudio, { passive: true });

function audioReady() {                  // 有 ctx 就即刻返；冇就等用戶下一個觸碰（手勢內同步建立）
  if (ctx) return Promise.resolve();
  return new Promise(res => addEventListener('pointerdown', () => { unlockAudio(); res(); }, { once: true }));
}

addEventListener('keydown', e => {
  if (e.target.matches('input,select')) return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  if (e.code === 'ArrowRight') seek((seq?.currentTime || 0) + 2);
  if (e.code === 'ArrowLeft') seek((seq?.currentTime || 0) - 2);
});

addEventListener('dragover', e => { e.preventDefault(); $('#drop').classList.add('on'); });
addEventListener('dragleave', e => { if (!e.relatedTarget) $('#drop').classList.remove('on'); });
addEventListener('drop', e => {
  e.preventDefault(); $('#drop').classList.remove('on');
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f).catch(err => status('❌ ' + err.message));
});

/* ---------- 開機 ---------- */

(async () => {
  tk = new VerovioToolkit(await createVerovioModule());
  window.__sp = { get tk() { return tk; }, get seq() { return seq; }, get synth() { return synth; }, applyInstruments };
  status('準備好 · 上載樂譜或試示範');
  tick();
  if (new URLSearchParams(location.search).has('demo')) $('#demo').click();   // 分享用：index.html?demo=1 自動開示範
})();

# Score Player

上載樂譜 → 即刻用真樂器聲彈返出嚟，跟譜高亮（類 Soundslice，純前端、離線用得）。

## 開

```bash
cd ~/projects/sheetplayer && ./serve.py      # 8899；要 Audiveris 先認得 PDF／相片
# 開 http://localhost:8899  （示範：?demo=1）
```

必須經 http（ES module + AudioWorklet 唔食 `file://`）。成個 folder 放上 GitHub Pages / 任何 static host 都照行。

### 公開網站（純前端，冇 OMR）

**https://applegreentea2023.github.io/score/** （示範：加 `?demo=1`）
GitHub Pages，source = `~/projects/pages-hub/score/`。呢個版本**冇 server** → PDF／相片會出「呢個網站版冇認譜 server」。排譜／播放／跟譜高亮／換樂器全部照用。

### Tailscale 網內用（其他電腦／電話）

- **https://asus-laptop.taileb4f9e.ts.net:10444/** ← 直接開得（示範樂譜：加 `?demo=1`）
- WSL 側 server 冇起返就 `~/projects/sheetplayer/serve.sh`（`python3 -m http.server 8899 --bind 0.0.0.0`）
- 個 https 係 Windows 側 tailscale serve 做嘅（`tailscale serve --bg --https=10444 http://localhost:8899`），設定存喺 tailscaled，重開機都仲喺；要拆：`tailscale serve --https=10444 off`
- 必須 https 先有 secure context（AudioWorklet / wasm 要）

## 食乜嘢格式

| 格式 | 支援 | 點嚟 |
|---|---|---|
| `.musicxml` / `.xml` | ✅ | MuseScore：另存 → **MusicXML** |
| `.mxl`（壓縮版） | ✅ 自動解 zip | MuseScore：另存 → **Compressed MusicXML** |
| `.mei` / `.abc` | ✅（Verovio 直食） | 網上樂譜庫 |
| `.pdf` / `.jpg` / `.png` / `.tiff` / `.bmp` | ✅ 自動 OMR | 影相或掃描，見下 |

**PDF／相片**：`serve.py` 收到就掉去 **Audiveris**（batch 模式）認譜，出 `.mxl` 再交返前端，全程約 10–25 秒一頁。
認譜結果可以撳「存 MusicXML」下載，喺 MuseScore 改好再上載（OMR 一定有一兩個音要執）。

Audiveris 安裝位置（deb 拆出嚟，唔使 sudo）：
```bash
cd ~/omr && curl -LO https://github.com/Audiveris/audiveris/releases/download/5.11.0/Audiveris-5.11.0-ubuntu24.04-x86_64.deb
dpkg-deb -x Audiveris-5.11.0-ubuntu24.04-x86_64.deb audiveris    # 內建 JRE，唔使另外裝 Java
./audiveris/opt/audiveris/bin/Audiveris -batch -export -output out in.pdf
```
路徑可用 `AUDIVERIS=` 環境變數覆蓋。

## 做緊乜

1. **Verovio**（wasm）讀 MusicXML → 排譜出 SVG，順便 `renderToMIDI()` 出 MIDI，兩者共用同一份 tempo map。
2. **spessasynth** + General MIDI soundfont（TimGM6mb, 6MB）播 MIDI → 真實樂器聲。
3. 用 `seq.currentHighResolutionTime` 做時鐘，每 frame 問 Verovio `getElementsAtTime(ms)` 拎返「而家邊啲音符響」→ 加 `.hl` class 變紅 + 自動 scroll 跟住行。
4. 撳譜上任何一個元素 → `getTimeForElement(id)` → 跳去嗰個位。

## 樂器

**每個聲部各自揀樂器**（工具列會自動列出：Voice、Piano…），可以 e.g. Voice＝鋼琴、Piano＝鼓：

| 選項 | 做法 |
|---|---|
| 🎹 鋼琴（預設） | 該聲部 program → 0（Acoustic Grand） |
| 🥁 鼓 | 該聲部音符搬去 channel 9，音高再按音區映射：低音→大鼓 36、中音→小鼓 38、高音→hi-hat 42 |
| 🎼 原譜 | 用樂譜本身指定嘅 GM 樂器（Vocal → Choir Aahs 52、Piano → 0） |

**唔可以**照用原音高做鼓掣：高音譜音符喺鼓組等於 cymbal／bell，出嚟係刺耳尖叫。所以一定要按音區壓縮到 3 粒常用鼓。

## 對齊（畫面 vs 聲音）

**`ctx.outputLatency` 唔可靠**：實測 headless Chrome 報 128ms，但音頻實際出到嚟時 song clock 已經行快 **330–374ms**（5 個 attack 誤差 ±3ms）。信 `outputLatency` 就一定「畫面跑先、聲跑後」。

所以：**第一次播放時自動量度**（播放 3 秒，用 audio RMS 包絡 同 音符 onset 做相關，0–800ms 每 10ms 掃一次），結果存 `localStorage.spAuto`；再加工具列「⚖ 對齊」手動 trim（−800…+800ms，存 `spCal`）。

高亮時間 = 歌曲時間 − (autoMs + calMs)，即係對「而家聽到嘅聲」。

## 暫停／繼續

唔可以用 `seq.paused` 判斷「播完」——iOS resume 之後 `paused` 會忽然 true，會被誤判成完結、畫面從此凍結。改用 `t >= duration - 0.05`。暫停時亦唔好清走已亮住嘅音符（空 set 直接 return）。

全部喺 **MIDI 數據層**改再 reload（`seq.getMIDI()` → 改 statusByte → `loadNewSongList`）。用 `channel.setDrums()` 靠唔住：sequencer 之後送嘅 program change 會蓋返做 melodic。
每次都由原始 MIDI 出發，唔係就會將上次嘅改動疊上去（鼓 → 鋼琴會變鼓）。

音色來自 `vendor/TimGM6mb.sf2`（6MB General MIDI soundfont，128 種樂器 + 一套鼓）。

## 撳一行就播嗰行

撳樂譜任何一行（system）→ 由嗰行第一個小節開始播，播到下一行就自動停，status 會顯示「▶ 第 N 行（0:12–0:24）」。
手動撳播放／停止會清掉呢個限制（變回連續播放）。

## 快捷鍵

`Space` 播/停 · `←/→` 前後 2 秒 · `A+/A−` 縮放 · 速度 0.5×–1.5×（`playbackRate`，唔影響跟譜對位）

## 驗證

```bash
npm i          # 只係 devDependency（playwright 驗證用）
python3 -m http.server 8899 &
node verify.mjs
```

## 排版：跟返原譜斷行

MusicXML 有寫邊度斷行（`<print new-system="yes">` / `new-page`，Audiveris 同 MuseScore 都會寫），就用 `breaks: 'encoded'` 跟返，唔會自己重排。
**`setOptions()` 之後一定要 `redoLayout()`** —— 唔叫嘅話 `breaks` / `pageWidth` 全部靜靜咁唔生效（實測：同一份譜 auto = 4,4,4,1 亂斷，encoded = 4,4,4,1 跟原譜；冇 redoLayout 就永遠係 auto 嗰個結果）。

## OMR 前處理（踩過的坑）

1. **細圖直接放棄**：截圖 1011×1312 → 五線間距 9px → Audiveris `Sheet ignored`（log: "too low interline … try 300 DPI"）。→ `prepare()` 自動放大到 ~2600px 闊（Lanczos）。
2. **整頁認會塌一行**：放大後認到，但低音譜（全音符和弦）幾乎全失（61 音在高音譜、低音譜 1 音）。→ `collapsed()` 偵測「多譜表但有一行少於 15% 音」→ `system_omr()` 按橫向投影切出每個系統，逐個認（每行放大到 ~3600px 闊），再用 ElementTree 合併、measures 重新編號。
   - 實測：整頁 62 音（低音 1）→ 逐行 136 音（高音 71 / 低音 65）、33 小節，約 100 秒。
3. **唔好做二值化**：黑白 threshold + NEAREST 放大會令 Audiveris 只認到 6 個音。
4. **歌詞／速度字認唔到**：冇裝 tesseract（Audiveris log: "The collection of supported languages is empty"）。中文歌詞唔會保留，`♩=80` 亦唔會入 MIDI（一律 120 BPM，用速度掣調）。

## worksheet 式排版（練習題一頁 8 條短練習）

兩種情況會自動「逐個 system 重認」再合併：
1. `collapsed()` — 多譜表但有一行幾乎冇音（低音譜全音符和弦被吞）
2. `bad_rhythm()` — 有小節長度遠超拍號（例 4/4 但 12、28 拍）＝ 分唔到小節線

PDF 會先用 pymupdf 以 300 DPI 光柵化（最多 8 頁）再逐行切。

實測 Alfred 鼓譜（1 頁 11 條練習）：

| | 音符 | 小節 | 每小節拍數 | 總拍 |
|---|---|---|---|---|
| 整頁 | 252 | 40 | `{3,4,10,12,14,28}` ❌ | 263 |
| 逐行 | ~240 | ~46 | `{4}` ✅ | ~176 |

即係播放長度由 7:07 回到 ~1:30，小節線正常。

## 認譜準唔準（實測，Brahms 藝術歌曲 3 行譜 / 172 個音）

| 輸入 | 認到音符 | 音高啱 | 落啱拍（±1 拍） |
|---|---|---|---|
| 清晰 PDF（300 DPI） | 169 | 152 / 172 (88%) | 146 / 172 (85%) |
| 模擬手機相（縮細、斜 1.2°、柔焦、JPEG） | 168 | 163 / 172 (95%) | 151 / 172 (88%) |

即係：**音高大致啱，間中一個音八度或臨時記號錯；拍子整體跟得住，唔會亂**。密集鋼琴譜（多聲部、大量加線）會差啲。
Audiveris 認唔到速度字（"Zart" 之類）→ 一律 120 BPM，用上面 0.5×–1.5× 自己調。

## 已知限制

- 速度記號／漸強漸弱跟 MusicXML 標記；譜上無 tempo 就 120 BPM。
- 反覆記號、裝飾音：Verovio 已展開（同 MIDI 一致），但唔會顯示「而家第幾次」。
- 單一聲部輪廓（低音譜號跨手之類）照譜面，唔會自動分配左右手。
- 15MB vendor（Verovio wasm 7MB + soundfont 6MB）第一次載入要等，之後 browser cache。

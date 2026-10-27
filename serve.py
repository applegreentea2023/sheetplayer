#!/usr/bin/env python3
"""靜態檔 server + /api/omr（PDF／相片 → MusicXML，Audiveris 認譜）。

    ./serve.py            # http://localhost:8899
"""
import os
import shutil
import subprocess
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", 8899))
AUDIVERIS = os.environ.get("AUDIVERIS", os.path.expanduser("~/omr/audiveris/opt/audiveris/bin/Audiveris"))
MAX_BYTES = 40 << 20
OMR_EXTS = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".gif"}

_lock = threading.Lock()          # ponytail: 一次一件 OMR，Audiveris 本身已食晒全部核


def prepare(src, workdir):
    """細圖 Audiveris 會直接放棄（interline < 10px → 「Sheet ignored」）。
    所以細過 1800px 闊就先放大到 ~2600px（Lanczos），五線間距才夠 300 DPI 水平。"""
    from PIL import Image                      # 只喺要放大時才 import
    with Image.open(src) as im:
        w, h = im.size
        if max(w, h) >= 1800:
            return src, False
        k = min(4.0, 2600 / max(1, w))
        big = im.convert("RGB").resize((round(w * k), round(h * k)), Image.LANCZOS)
        dst = os.path.join(workdir, "up.png")
        big.save(dst)
        print(f"[omr] 放大 {w}x{h} → {big.size[0]}x{big.size[1]} (x{k:.1f})", flush=True)
        return dst, True


def recognise(src, name, workdir):
    """Audiveris batch → .mxl bytes。冇認到任何東西就 raise。"""
    if os.path.splitext(src)[1].lower() != ".pdf":
        src, upscaled = prepare(src, workdir)
    out = os.path.join(workdir, "out")
    os.makedirs(out, exist_ok=True)
    proc = subprocess.run(
        [AUDIVERIS, "-batch", "-export", "-output", out, src],
        capture_output=True, text=True, timeout=900, cwd=workdir,
    )
    found = [f for f in os.listdir(out) if f.endswith(".mxl")]
    if not found:
        log = (proc.stderr or "") + (proc.stdout or "")
        logs = [open(os.path.join(out, f), encoding="utf-8", errors="replace").read()
                for f in os.listdir(out) if f.endswith(".log")]
        blob = log + " " + " ".join(logs)
        print("[omr] Audiveris 冇輸出：", (proc.stderr or proc.stdout or "")[-600:], flush=True)
        if "too low interline" in blob or "resolution is too low" in blob:
            raise RuntimeError("圖片解像度太低（五線間距太細）。請用原圖／放大截圖，或者影 300 DPI 以上")
        if "no staff" in blob.lower() or "Sheet ignored" in blob:
            raise RuntimeError("搵唔到五線譜（係唔係樂譜圖？試下整頁影齊、光猛啲）")
        raise RuntimeError("認唔到樂譜（空白頁？影得唔清？試下光猛啲、整頁影齊）")
    with open(os.path.join(out, found[0]), "rb") as fh:
        data = fh.read()
    if len(data) < 2000:          # 空白頁／認唔到嘅譜：得個殼
        raise RuntimeError("認唔到樂譜（頁面太模糊、或者唔係五線譜？）")
    return data


# ---------- system-by-system OMR（整頁會漏低音譜全音符和弦） ----------

def staff_counts(xml):
    import collections, re
    c = collections.Counter()
    for n in re.findall(r"<note\b.*?</note>", xml, re.S):
        m = re.search(r"<staff>(\d+)</staff>", n)
        c[m.group(1) if m else "1"] += 1
    return c


def collapsed(xml):
    """多譜表樂譜但其中一行幾乎冇音 → 整頁 OMR 失敗，要逐行重認。"""
    c = staff_counts(xml)
    if len(c) < 2:
        return False
    top = max(c.values())
    return min(c.values()) < top * 0.15


def bands(img):
    """用橫向投影搵出每個 system 嘅垂直範圍。"""
    from PIL import ImageOps
    g = ImageOps.grayscale(img)
    w, h = g.size
    px = g.load()
    flags, start, empty, out = [], None, 0, []
    for y in range(h):
        ink = 0
        for x in range(0, w, 2):
            if px[x, y] < 200:
                ink += 1
                if ink >= 3:
                    break
        if ink >= 3:
            if start is None:
                start = y
            empty = 0
        elif start is not None:
            empty += 1
            if empty > 8:
                out.append((start, y - empty))
                start = None
    if start is not None:
        out.append((start, h - 1))
    return [b for b in out if b[1] - b[0] > 40]


def system_omr(src, workdir):
    """逐個 system 認，再合併成一份 MusicXML。"""
    from PIL import Image
    import xml.etree.ElementTree as ET
    im = Image.open(src).convert("RGB")
    bs = bands(im)
    print(f"[omr] 逐行認：{len(bs)} 個 system", flush=True)
    xmls = []
    for i, (y0, y1) in enumerate(bs):
        crop = im.crop((0, max(0, y0 - 12), im.width, min(im.height, y1 + 12)))
        k = max(2.0, min(4.0, 3600 / im.width))     # 每行放大到 ~3600px 闊（太大反而認唔到）
        crop = crop.resize((round(crop.width * k), round(crop.height * k)), Image.LANCZOS)
        d = os.path.join(workdir, f"strip{i}")
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, "in.png")
        crop.save(p)
        out = os.path.join(d, "out")
        subprocess.run([AUDIVERIS, "-batch", "-export", "-output", out, p],
                       capture_output=True, text=True, timeout=600, cwd=d)
        mxl = [f for f in os.listdir(out) if f.endswith(".mxl")] if os.path.isdir(out) else []
        if not mxl:
            print(f"[omr] strip {i} 失敗，跳過", flush=True)
            continue
        import zipfile
        z = zipfile.ZipFile(os.path.join(out, mxl[0]))
        name = [n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0]
        x = z.read(name).decode()
        print(f"[omr] strip {i}: {dict(staff_counts(x))}", flush=True)
        xmls.append(x)
    if not xmls:
        raise RuntimeError("逐行認都認唔到（圖太模糊？）")
    first = ET.fromstring(xmls[0])
    root = ET.Element("score-partwise", {"version": first.get("version", "4.0")})
    pl = first.find("part-list")
    if pl is not None:
        root.append(pl)
    for pid in [p.get("id") for p in first.findall("part")]:
        out_p = ET.SubElement(root, "part", {"id": pid})
        n = 0
        for x in xmls:
            for p in ET.fromstring(x).findall("part"):
                if p.get("id") != pid:
                    continue
                for m in p.findall("measure"):
                    n += 1
                    m.set("number", str(n))
                    out_p.append(m)
    merged = ET.tostring(root, encoding="unicode")
    print(f"[omr] 合併完：{dict(staff_counts(merged))}", flush=True)
    return merged


def mxl_to_xml(data):
    """mxl(zip) 或純 XML bytes → XML 字串。"""
    if data[:2] == b"PK":
        import io, zipfile
        z = zipfile.ZipFile(io.BytesIO(data))
        name = [n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0]
        return z.read(name).decode("utf-8", "replace")
    return data.decode("utf-8", "replace")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def fail(self, code, msg):
        """send_error 用 latin-1 寫 status line，中文會 UnicodeEncodeError → 自己出 body"""
        body = msg.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # vendor/（15MB 大檔）先可以 cache；app.js / index.html 一定 no-store，唔係改完用戶仲跑舊 code
        cacheable = self.path.startswith("/vendor/") or self.path.startswith("/samples/")
        self.send_header("Cache-Control", "max-age=600" if cacheable else "no-store")
        super().end_headers()

    def do_POST(self):
        if self.path.split("?")[0] != "/api/omr":
            return self.fail(404, "not found")
        n = int(self.headers.get("Content-Length") or 0)
        if not 0 < n <= MAX_BYTES:
            return self.fail(413, "檔案太大（>40MB）或空")
        payload = self.rfile.read(n)      # 一定要先讀晒 body，否則早回錯誤會 RST 斷線（curl 見 000）
        name = os.path.basename(self.headers.get("X-Filename", "input.png"))
        ext = os.path.splitext(name)[1].lower()
        if ext not in OMR_EXTS:
            return self.fail(415, "只食 PDF／PNG／JPG／TIFF／BMP／GIF")
        try:
            with _lock, tempfile.TemporaryDirectory() as work:
                src = os.path.join(work, "in" + ext)
                with open(src, "wb") as fh:
                    fh.write(payload)
                img = src
                if ext != ".pdf":
                    img, _ = prepare(src, work)      # 細圖先放大（Audiveris 要求 interline 夠大）
                data = recognise(img, name, work)
                xml = mxl_to_xml(data)
                if collapsed(xml):                   # 整頁 OMR 塌咗一行（例：低音譜全音符和弦）→ 逐行重認
                    print("[omr] 有譜表幾乎全空 → 改用逐個 system 認", flush=True)
                    data = system_omr(src, work).encode()   # 用原圖逐行放大（放大版再 ×4 會過大）
        except subprocess.TimeoutExpired:
            return self.fail(504, "認譜超時（>15 分鐘）")
        except Exception as e:                       # noqa: BLE001 — 一律回人話
            return self.fail(500, str(e).replace("\n", " ")[:300])
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.recordare.musicxml")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):              # 靜返啲，OMR log 唔想炒滿 terminal
        if not self.path.startswith("/api/"):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    assert shutil.which("python3"), "python3 missing"
    assert os.access(AUDIVERIS, os.X_OK), f"AUDIVERIS 唔存在或冇執行權: {AUDIVERIS}"
    print(f"http://0.0.0.0:{PORT}/  (OMR: {AUDIVERIS})")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

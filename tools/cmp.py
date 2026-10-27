"""Compare two MIDI files: pitch+timing match. Run: uv run --with mido python3 cmp.py gt.mid omr.mid"""
import sys
import mido


def notes(path):
    mf = mido.MidiFile(path)
    t, out = 0.0, []
    for msg in mf:                      # mido 逐條 track 已轉秒
        t += msg.time
        if msg.type == 'note_on' and msg.velocity > 0:
            out.append((t, msg.note))
    return out


def match(gt, om, tol):
    """Greedy pitch match within tol seconds (same pitch, nearest time)."""
    om = sorted(om)
    used = [False] * len(om)
    hit = 0
    for t, p in sorted(gt):
        best, bd = -1, tol
        for i, (t2, p2) in enumerate(om):
            if not used[i] and p2 == p:
                d = abs(t2 - t)
                if d <= bd:
                    best, bd = i, d
        if best >= 0:
            used[best] = True
            hit += 1
    return hit


if __name__ == '__main__':
    a, b = (sys.argv[1:3] or ['gt.mid', 'omr.mid'])
    gt, om = notes(a), notes(b)
    dur_g, dur_o = max(t for t, _ in gt), max(t for t, _ in om)
    k = dur_g / dur_o                      # OMR 冇咗 tempo 字（Zart 96 vs default 120）→ 先正規化再比節奏
    om = [(t * k, p) for t, p in om]
    hi, lo = match(gt, om, 0.12), match(gt, om, 0.6)
    print(f'gt={len(gt)} omr={len(om)} | strict(±120ms)={hi} ({hi/len(gt):.0%} recall) '
          f'| loose(±600ms)={lo} ({lo/len(gt):.0%} recall) | dur {dur_g:.1f}s vs {dur_o:.1f}s (tempo ×{k:.2f})')
    assert len(gt) > 0 and len(om) > 0

"""Verovio timemap vs MIDI note-on 對齊檢查。uv run --with mido python3 synctest.py"""
import bisect
import json
import mido

vt = sorted(json.load(open('/tmp/verovio_times.json')))          # ms
t, midi = 0.0, []
for m in mido.MidiFile('/home/user/omr/gt.mid'):
    t += m.time
    if m.type == 'note_on' and m.velocity > 0:
        midi.append(t * 1000)
midi.sort()
print('verovio onsets', len(vt), '| midi note-ons', len(midi))
print('verovio first/last', vt[0], round(vt[-1]), '| midi first/last', round(midi[0]), round(midi[-1]))

errs = []
for x in midi:
    i = bisect.bisect_left(vt, x)
    cands = [vt[j] for j in (i - 1, i, i + 1) if 0 <= j < len(vt)]
    errs.append(min(abs(c - x) for c in cands))
errs.sort()
print('nearest-onset error: median %.0fms  p90 %.0fms  max %.0fms'
      % (errs[len(errs) // 2], errs[int(len(errs) * 0.9)], errs[-1]))

import sys, json, math
import numpy as np
from scipy.signal import find_peaks

# Usage: py -3 beat_analyze.py <wav_path>
# Outputs JSON with bpm, beats, strong_beats, duration, confidence, waveform (downsampled peaks), sections

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "wav path required"}))
        return
    path = sys.argv[1]
    try:
        import wave
        with wave.open(path, 'rb') as wf:
            sr = wf.getframerate()
            nchan = wf.getnchannels()
            sw = wf.getsampwidth()
            nframes = wf.getnframes()
            raw = wf.readframes(nframes)
        if sw == 2:
            data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        elif sw == 1:
            data = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
        elif sw == 4:
            data = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
        else:
            data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        if nchan > 1:
            data = data.reshape(-1, nchan).mean(axis=1)
        if sr <= 0 or data.size == 0:
            raise Exception("Invalid audio")
        duration = float(data.size) / float(sr)

        # Downsample for analysis
        target_sr = 22050
        if sr != target_sr:
            # simple resample
            idx = np.linspace(0, data.size - 1, int(data.size * target_sr / sr))
            sig = np.interp(idx, np.arange(data.size), data).astype(np.float32)
            sr_a = target_sr
        else:
            sig = data.astype(np.float32)
            sr_a = sr

        # Onset/envelope: frame energy with hop
        hop = 512
        frame_len = 1024
        if sig.size < frame_len + hop:
            print(json.dumps({"bpm": 0, "duration": duration, "beats": [], "strong_beats": [], "confidence": 0, "waveform": [], "sections": [], "total_beats": 0, "strong_beat_count": 0}))
            return
        nframes_a = 1 + (sig.size - frame_len) // hop
        env = np.zeros(nframes_a, dtype=np.float32)
        for i in range(nframes_a):
            s = i * hop
            fr = sig[s:s+frame_len]
            if fr.size == 0: continue
            # RMS
            env[i] = np.sqrt(np.mean(fr * fr) + 1e-12)
        # spectral flux-like diff on envelope
        diff = np.diff(env)
        onset_env = np.maximum(0, diff)
        if onset_env.size < 4:
            onset_env = np.maximum(onset_env, 0)
        # smooth
        k = 3
        if onset_env.size > k:
            kernel = np.ones(k) / k
            onset_env_s = np.convolve(onset_env, kernel, mode='same')
        else:
            onset_env_s = onset_env
        times = (np.arange(onset_env_s.size) * hop + frame_len/2) / sr_a

        # Peak picking for onsets/beats candidates
        min_bpm, max_bpm = 60, 180
        min_dist = int((60.0 / max_bpm) * sr_a / hop)
        min_dist = max(2, min_dist)
        prom = float(np.percentile(onset_env_s, 70)) * 0.6 if onset_env_s.size else 0.01
        prom = max(prom, 1e-5)
        peaks, props = find_peaks(onset_env_s, distance=min_dist, prominence=prom)
        peak_times = times[peaks].tolist() if peaks.size else []
        peak_vals = onset_env_s[peaks] if peaks.size else np.array([])

        # Tempo estimation via autocorrelation of onset envelope
        bpm = 0.0
        confidence = 0.0
        if onset_env_s.size > 10:
            oe = onset_env_s - np.mean(onset_env_s)
            ac = np.correlate(oe, oe, mode='full')[len(oe)-1:]
            if ac.size > 1 and ac[0] != 0:
                ac = ac / (ac[0] + 1e-12)
            # lag range for bpm
            lag_min = int((60.0 / max_bpm) * sr_a / hop)
            lag_max = int((60.0 / min_bpm) * sr_a / hop)
            lag_min = max(1, lag_min)
            lag_max = min(len(ac)-1, lag_max)
            if lag_max > lag_min + 1:
                seg = ac[lag_min:lag_max+1]
                best_i = int(np.argmax(seg)) + lag_min
                best_val = float(ac[best_i])
                # parabolic-ish confidence proxy
                conf = float(np.clip((best_val - float(np.median(seg))) / (abs(float(np.max(seg))) + 1e-9), 0, 1))
                bpm = 60.0 * sr_a / (hop * best_i)
                # octave check
                if bpm < 70 and bpm*2 <= 180:
                    bpm *= 2
                if bpm > 170 and bpm/2 >= 60:
                    bpm /= 2
                confidence = max(0.15, min(0.98, 0.35 + conf * 0.8))

        # If bpm unreliable, estimate from peak intervals
        if (bpm <= 0 or confidence < 0.3) and len(peak_times) >= 3:
            ivals = np.diff(np.array(peak_times))
            ivals = ivals[(ivals > 0.25) & (ivals < 1.2)]
            if ivals.size:
                med = float(np.median(ivals))
                if med > 0:
                    est = 60.0 / med
                    if 60 <= est <= 180:
                        bpm = est
                        confidence = max(confidence, 0.35)
                    elif 30 <= est < 60:
                        bpm = est * 2
                        confidence = max(confidence, 0.3)

        # Generate beat grid from bpm if available, else use peaks
        beats = []
        if bpm >= 50 and duration > 0:
            period = 60.0 / bpm
            # align phase to strongest peak
            start_t = 0.0
            if len(peak_times) > 0 and peak_vals.size > 0:
                start_t = float(peak_times[int(np.argmax(peak_vals))]) % period
            t = start_t
            while t < duration - 0.05:
                if t >= 0: beats.append(round(float(t), 3))
                t += period
            if not beats and peak_times:
                beats = [round(float(x),3) for x in peak_times]
        else:
            beats = [round(float(x),3) for x in peak_times]
        beats = sorted(list(dict.fromkeys(beats)))

        # Strong beats: peaks with high energy and/or every 4th beat
        strong = []
        if beats:
            # map envelope strength
            beat_strength = []
            for b in beats:
                idx = int(b * sr_a / hop)
                idx = min(max(idx, 0), len(env)-1)
                beat_strength.append(float(env[idx]) if env.size else 0.0)
            if beat_strength:
                thr = float(np.percentile(beat_strength, 70)) if len(beat_strength) > 3 else (max(beat_strength)*0.8 if beat_strength else 0)
                for i, b in enumerate(beats):
                    if beat_strength[i] >= thr or (bpm > 0 and i % 4 == 0):
                        strong.append(b)
            if not strong and beats:
                strong = beats[::4]
        strong = sorted(list(dict.fromkeys(strong)))

        # Sections from RMS energy over windows
        sections = []
        try:
            win = max(1, int(2.0 * sr_a / hop))  # ~2s windows
            if env.size >= win:
                nsec = int(math.ceil(env.size / win))
                vals = []
                for i in range(nsec):
                    segv = env[i*win:(i+1)*win]
                    vals.append(float(np.mean(segv)) if segv.size else 0.0)
                if vals:
                    vmin, vmax = min(vals), max(vals)
                    def lab(v):
                        if vmax - vmin < 1e-9: return "steady"
                        r = (v - vmin) / (vmax - vmin + 1e-12)
                        if r < 0.25: return "low"
                        if r < 0.5: return "build-up"
                        if r < 0.75: return "high"
                        return "drop"
                    cur_label = lab(vals[0]); cur_start = 0.0
                    for i in range(1, len(vals)):
                        l = lab(vals[i])
                        if l != cur_label:
                            sections.append({"start": round(cur_start,2), "end": round(min(duration, i*2.0),2), "type": cur_label})
                            cur_label = l; cur_start = i*2.0
                    sections.append({"start": round(cur_start,2), "end": round(duration,2), "type": cur_label})
        except Exception:
            sections = []

        # Waveform downsample for UI (peaks)
        waveform = []
        try:
            points = 300
            step = max(1, int(sig.size / points))
            for i in range(0, sig.size, step):
                chunk = sig[i:i+step]
                if chunk.size == 0: continue
                waveform.append([round(float(np.min(chunk)),4), round(float(np.max(chunk)),4)])
            if len(waveform) > 600:
                # downsample
                idx = np.linspace(0, len(waveform)-1, 400).astype(int)
                waveform = [waveform[i] for i in idx]
        except Exception:
            waveform = []

        out = {
            "bpm": round(float(bpm), 2) if bpm else 0,
            "duration": round(duration, 3),
            "beats": beats,
            "strong_beats": strong,
            "sections": sections,
            "confidence": round(float(confidence), 3),
            "total_beats": len(beats),
            "strong_beat_count": len(strong),
            "waveform": waveform,
        }
        print(json.dumps(out, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()

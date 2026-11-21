"""LaMa ONNX inpainting for video watermarks. CPU-only, streams frames to FFmpeg.

Usage:
  python wm_inpaint.py --input in.mp4 --output out.mp4 \
      --regions '[[xP,yP,wP,hP],...]' --mode video --stride 1 --ffmpeg ffmpeg
  python wm_inpaint.py --input in.mp4 --output out.png \
      --regions '[[xP,yP,wP,hP]]' --mode image --time 5.0
"""
import argparse, json, os, subprocess, sys, time
import cv2
import numpy as np
import onnxruntime as ort

MODEL = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "storage", "models", "lama_int4_int8_r4.onnx")
CROP = 512
_session = None


MODEL_URL = "https://huggingface.co/othytenk/lama-int4-int8/resolve/main/lama_int4_int8_r4.onnx"


def ensure_model():
    if os.path.exists(MODEL) and os.path.getsize(MODEL) > 10000000:
        return
    import urllib.request
    os.makedirs(os.path.dirname(MODEL), exist_ok=True)
    print("Mengunduh model LaMa (~37 MB)...", flush=True)
    tmp = MODEL + ".part"
    urllib.request.urlretrieve(MODEL_URL, tmp)
    os.replace(tmp, MODEL)
    print("Model siap.", flush=True)


def get_session():
    global _session
    if _session is None:
        ensure_model()
        so = ort.SessionOptions()
        so.add_session_config_entry("session.disable_quant_qdq", "1")
        so.intra_op_num_threads = max(1, min(4, os.cpu_count() or 2))
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        _session = ort.InferenceSession(MODEL, so, providers=["CPUExecutionProvider"])
    return _session


def even(n):
    n = int(round(n))
    return max(2, n - (n % 2))


def region_box(w, h, xP, yP, wP, hP):
    x = even(w * xP / 100.0 - 2)
    y = even(h * yP / 100.0 - 2)
    bw = even(w * wP / 100.0 + 4)
    bh = even(h * hP / 100.0 + 4)
    x = min(x, max(2, w - 8))
    y = min(y, max(2, h - 8))
    bw = even(min(bw, w - 2 - x))
    bh = even(min(bh, h - 2 - y))
    return x, y, bw, bh


def inpaint_frame(frame, boxes):
    """Run LaMa on each box. Hard mask, 512x512 crop, composite back."""
    h, w = frame.shape[:2]
    sess = get_session()
    result = frame.copy()
    for (x, y, bw, bh) in boxes:
        if bw < 4 or bh < 4:
            continue
        cx, cy = x + bw // 2, y + bh // 2
        x0 = max(0, min(w - CROP, cx - CROP // 2))
        y0 = max(0, min(h - CROP, cy - CROP // 2))
        crop = result[y0:y0 + CROP, x0:x0 + CROP].copy()

        mask = np.zeros((CROP, CROP), np.uint8)
        rx, ry = x - x0, y - y0
        mx0 = max(0, rx); my0 = max(0, ry)
        mx1 = min(CROP, rx + bw); my1 = min(CROP, ry + bh)
        if mx1 <= mx0 or my1 <= my0:
            continue
        mask[my0:my1, mx0:mx1] = 255

        image_t = np.transpose(
            cv2.cvtColor(crop, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0,
            (2, 0, 1))[None]
        mask_t = (mask.astype(np.float32) / 255.0)[None, None]
        out = sess.run(None, {"image": image_t, "mask": mask_t})[0]
        filled = np.clip(np.squeeze(out).transpose(1, 2, 0), 0, 255).astype(np.uint8)
        filled = cv2.cvtColor(filled, cv2.COLOR_RGB2BGR)
        crop[mask > 0] = filled[mask > 0]
        result[y0:y0 + CROP, x0:x0 + CROP] = crop
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--regions", required=True, help='JSON [[x,y,w,h],...] in percent')
    ap.add_argument("--mode", choices=["image", "video"], default="video")
    ap.add_argument("--time", type=float, default=1.5)
    ap.add_argument("--stride", type=int, default=1)
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--duration", type=float, default=0.0)
    ap.add_argument("--ffmpeg", default="ffmpeg")
    a = ap.parse_args()

    cap = cv2.VideoCapture(a.input)
    if not cap.isOpened():
        print("ERROR: tidak bisa membaca video", flush=True)
        sys.exit(1)
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1

    regions = json.loads(a.regions)
    boxes = [region_box(W, H, r[0], r[1], r[2], r[3]) for r in regions[:8]]

    if a.mode == "image":
        cap.set(cv2.CAP_PROP_POS_MSEC, a.time * 1000)
        ok, frame = cap.read()
        cap.release()
        if not ok:
            print("ERROR: gagal ambil frame", flush=True)
            sys.exit(1)
        out = inpaint_frame(frame, boxes)
        cv2.imwrite(a.output, out, [cv2.IMWRITE_PNG_COMPRESSION, 3])
        print("OK image", flush=True)
        return

    # video: stream BGR frames into FFmpeg, audio taken from original input
    cmd = [a.ffmpeg, "-y", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", f"{fps}", "-i", "-",
           "-i", a.input,
           "-map", "0:v:0", "-map", "1:a?",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
           "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
           "-shortest", "-movflags", "+faststart", a.output]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    stride = max(1, a.stride)
    start = max(0.0, a.start)
    end = start + a.duration if a.duration > 0 else float("inf")
    if start > 0:
        cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000)
    idx = 0
    processed = 0
    t0 = time.time()
    try:
        while True:
            # POS_MSEC is milliseconds; end is in seconds.
            if cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0 >= end:
                break
            ok, frame = cap.read()
            if not ok:
                break
            if idx % stride == 0:
                frame = inpaint_frame(frame, boxes)
                processed += 1
            proc.stdin.write(frame.tobytes())
            idx += 1
            if idx % 10 == 0:
                print(f"PROGRESS {idx}/{total}", flush=True)
    finally:
        cap.release()
        try:
            proc.stdin.close()
        except Exception:
            pass
    err = proc.stderr.read().decode("utf-8", "replace")[-500:]
    code = proc.wait()
    if code != 0:
        print("ERROR ffmpeg: " + err, flush=True)
        sys.exit(1)
    print(f"OK video frames={idx} processed={processed} secs={time.time()-t0:.1f}", flush=True)


if __name__ == "__main__":
    main()

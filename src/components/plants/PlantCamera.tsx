"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, ImageUp, Loader2, Repeat, SwitchCamera } from "lucide-react";
import { DEVICE_ID, apiUpload } from "@/lib/api";

export type PlantImage = {
  id: number;
  ts: number;
  day: number;
  stage: string;
  canopy_pct: number;
  npk_label: string | null;
  npk_confidence: number | null;
  note: string | null;
  url: string;
  result: {
    canopy_pct: number;
    npk: {
      available: boolean;
      reason?: string;
      label?: string;
      label_text?: string;
      confidence?: number;
      probs?: Record<string, number>;
      low_confidence?: boolean;
    };
  };
};

export const NPK_TEXT: Record<string, string> = {
  healthy: "Healthy",
  n_deficient: "Nitrogen deficient",
  p_deficient: "Phosphorus deficient",
  k_deficient: "Potassium deficient",
};

export const NPK_TONE: Record<string, string> = {
  healthy: "var(--c-leaf)",
  n_deficient: "var(--c-amber)",
  p_deficient: "var(--c-violet)",
  k_deficient: "var(--c-red)",
};

const AUTO_HOURS = [1, 3, 6, 12];

/** Browser / USB / phone camera with file upload fallback. Saves each photo to the backend,
 *  which stores it, measures canopy cover and runs the N/P/K model. */
export default function PlantCamera({ demo, onSaved, compact = false }: {
  demo: boolean;
  onSaved?: (img: PlantImage) => void;
  compact?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [on, setOn] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [autoHours, setAutoHours] = useState<number | null>(null);
  const [nextAuto, setNextAuto] = useState<number | null>(null);
  const [last, setLast] = useState<PlantImage | null>(null);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setOn(false);
  }, []);

  const start = useCallback(async (id?: string) => {
    setMsg(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMsg({ text: "This browser cannot open a camera here (it needs https or localhost). Upload a photo instead.", ok: false });
      return;
    }
    try {
      stop();
      const s = await navigator.mediaDevices.getUserMedia({
        video: id ? { deviceId: { exact: id }, width: { ideal: 1280 } } : { facingMode: "environment", width: { ideal: 1280 } },
        audio: false,
      });
      stream.current = s;
      if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}); }
      setOn(true);
      const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
      setDevices(all);
      setDeviceId(s.getVideoTracks()[0]?.getSettings().deviceId);
    } catch (e: any) {
      setMsg({ text: e?.name === "NotAllowedError" ? "Camera permission was refused. Allow it in the browser, or upload a photo." : `Camera could not start: ${e?.message ?? e}`, ok: false });
    }
  }, [stop]);

  useEffect(() => stop, [stop]);

  const send = useCallback(async (blob: Blob, name: string) => {
    if (demo) {
      setMsg({ text: "Demo mode: start the HY-ARIA backend on this computer to save and analyse photos.", ok: false });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append("file", blob, name);
      if (note.trim()) form.append("note", note.trim());
      const row = await apiUpload<PlantImage>(`/api/devices/${DEVICE_ID}/images`, form);
      setLast(row);
      onSaved?.(row);
      const npk = row.result.npk;
      setMsg({
        ok: true,
        text: !npk.available ? `Saved. Canopy ${row.canopy_pct}%. Deficiency model unavailable: ${npk.reason}`
          : npk.low_confidence ? `Saved. Model unsure (${Math.round((npk.confidence ?? 0) * 100)}%): retake closer, in even light.`
          : `Saved. ${npk.label_text} (${Math.round((npk.confidence ?? 0) * 100)}%), canopy ${row.canopy_pct}%.`,
      });
    } catch (e: any) {
      setMsg({ text: `Upload failed: ${e.message}`, ok: false });
    } finally {
      setBusy(false);
    }
  }, [demo, note, onSaved]);

  const capture = useCallback(async () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.9));
    if (blob) await send(blob, `capture-${Date.now()}.jpg`);
  }, [send]);

  // optional timed capture while the page stays open (builds the growth timeline)
  useEffect(() => {
    if (!autoHours || !on) { setNextAuto(null); return; }
    const period = autoHours * 3600 * 1000;
    setNextAuto(Date.now() + period);
    const t = setInterval(() => { capture(); setNextAuto(Date.now() + period); }, period);
    return () => clearInterval(t);
  }, [autoHours, on, capture]);

  const npk = last?.result.npk;

  return (
    <div className="space-y-3">
      <div className={`relative rounded-2xl overflow-hidden border border-line bg-card-2 ${compact ? "aspect-video" : "aspect-[4/3]"}`}>
        <video ref={video} playsInline muted className={`absolute inset-0 w-full h-full object-cover ${on ? "" : "hidden"}`} />
        {!on && (
          <div className="absolute inset-0 grid place-items-center text-center p-6">
            <div>
              <CameraOff size={28} className="mx-auto text-faint" />
              <p className="text-sm text-text-muted mt-3">Camera off</p>
              <p className="text-xs text-faint mt-1 max-w-xs">Use this laptop's webcam, a USB camera, or open this page on your phone.</p>
            </div>
          </div>
        )}
        {on && (
          <div aria-hidden className="absolute inset-[12%] border-2 border-dashed rounded-2xl pointer-events-none" style={{ borderColor: "color-mix(in srgb, var(--c-leaf) 55%, transparent)" }} />
        )}
        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-black/40">
            <Loader2 className="animate-spin text-primary" size={28} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {!on ? (
          <button onClick={() => start(deviceId)} className="btn btn-primary px-4 py-2 text-xs"><Camera size={14} /> Start camera</button>
        ) : (
          <>
            <button onClick={capture} disabled={busy} className="btn btn-primary px-4 py-2 text-xs disabled:opacity-50"><Camera size={14} /> Capture</button>
            <button onClick={stop} className="btn btn-ghost px-3 py-2 text-xs"><CameraOff size={14} /> Stop</button>
            {devices.length > 1 && (
              <button
                onClick={() => {
                  const i = devices.findIndex((d) => d.deviceId === deviceId);
                  start(devices[(i + 1) % devices.length].deviceId);
                }}
                className="btn btn-ghost px-3 py-2 text-xs"
              ><SwitchCamera size={14} /> Switch</button>
            )}
          </>
        )}
        <button onClick={() => fileInput.current?.click()} disabled={busy} className="btn btn-ghost px-3 py-2 text-xs disabled:opacity-50"><ImageUp size={14} /> Upload photo</button>
        <input
          ref={fileInput} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f, f.name); e.target.value = ""; }}
        />
      </div>

      {!compact && (
        <div className="grid sm:grid-cols-2 gap-2">
          <input
            value={note} onChange={(e) => setNote(e.target.value)} maxLength={120}
            placeholder="Note (optional): tier 2, pot 3"
            className="rounded-xl border border-line bg-card px-3 py-2 text-xs outline-none focus:border-primary/60"
          />
          <label className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-xs text-text-muted">
            <Repeat size={14} className="shrink-0" />
            <span className="shrink-0">Auto capture</span>
            <select
              value={autoHours ?? ""} onChange={(e) => setAutoHours(e.target.value ? Number(e.target.value) : null)}
              className="ml-auto bg-transparent text-foreground outline-none num"
            >
              <option value="">off</option>
              {AUTO_HOURS.map((h) => <option key={h} value={h}>every {h} h</option>)}
            </select>
          </label>
        </div>
      )}
      {autoHours && (
        <p className="text-[11px] text-faint">
          {on && nextAuto ? `Next photo at ${new Date(nextAuto).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. ` : "Start the camera to begin. "}
          Works only while this page stays open; keep the camera in the same place so canopy cover is comparable.
        </p>
      )}

      {msg && (
        <p className="text-xs leading-snug" style={{ color: msg.ok ? "var(--c-muted)" : "var(--c-amber)" }}>{msg.text}</p>
      )}
      {npk?.available && npk.probs && !compact && (
        <div className="space-y-1.5">
          {Object.entries(npk.probs).sort((a, b) => b[1] - a[1]).map(([k, p]) => (
            <div key={k} className="flex items-center gap-2 text-[11px]">
              <span className="w-32 text-text-muted shrink-0">{NPK_TEXT[k] ?? k}</span>
              <div className="flex-1 h-1.5 rounded-full bg-card-2 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${p * 100}%`, background: NPK_TONE[k] ?? "var(--c-leaf)" }} />
              </div>
              <span className="num w-10 text-right">{Math.round(p * 100)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

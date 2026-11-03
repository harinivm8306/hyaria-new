"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CloudOff, Leaf, Trash2 } from "lucide-react";
import PlantCamera, { NPK_TEXT, NPK_TONE, type PlantImage } from "@/components/plants/PlantCamera";
import { API_BASE, DEVICE_ID, apiGet } from "@/lib/api";

type ModelInfo = {
  available: boolean;
  reason: string | null;
  min_confidence: number;
  metrics: null | { eval: { accuracy: number; val_images: number }; split: Record<string, { total: number }> };
};

const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleDateString([], { day: "numeric", month: "short" });
const fmtTime = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function PlantsPage() {
  const [images, setImages] = useState<PlantImage[]>([]);
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [demo, setDemo] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<PlantImage | null>(null);

  const load = useCallback(async () => {
    try {
      const [imgs, m] = await Promise.all([
        apiGet<PlantImage[]>(`/api/devices/${DEVICE_ID}/images?limit=500`, 5000),
        apiGet<ModelInfo>(`/api/vision/npk`, 5000),
      ]);
      setImages(imgs); setModel(m); setDemo(false);
    } catch {
      setDemo(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const remove = async (img: PlantImage) => {
    if (!confirm("Delete this photo from the timeline?")) return;
    await fetch(`${API_BASE}/api/images/${img.id}`, { method: "DELETE" });
    setOpen(null);
    load();
  };

  const byDay = useMemo(() => {
    const groups = new Map<string, PlantImage[]>();
    for (const img of images) {
      const k = new Date(img.ts * 1000).toDateString();
      groups.set(k, [...(groups.get(k) ?? []), img]);
    }
    return Array.from(groups.entries());
  }, [images]);

  const curve = useMemo(
    () => [...images].reverse().map((i) => ({ day: Number(i.day.toFixed(1)), canopy: i.canopy_pct, label: `${fmtDate(i.ts)} ${fmtTime(i.ts)}` })),
    [images],
  );

  const latest = images[0];
  const m = model?.metrics;

  return (
    <main className="pt-24 pb-16">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
        <div className="mb-6">
          <p className="eyebrow flex items-center gap-2 mb-3"><Leaf size={13} /> Plant camera · {DEVICE_ID}</p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold">Plants</h1>
          <p className="mt-2 text-text-muted max-w-2xl">
            Take a photo of the canopy. Each photo is saved to a timeline, its green leaf cover is measured, and the
            N/P/K model checks for nitrogen, phosphorus or potassium deficiency. The dosing controller only adds a nutrient
            when the ion sensor also reads it low.
          </p>
        </div>

        {demo && loaded && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: "color-mix(in srgb, var(--c-amber) 40%, transparent)", background: "color-mix(in srgb, var(--c-amber) 7%, transparent)" }}>
            <CloudOff size={18} className="text-accent shrink-0 mt-0.5" />
            <p className="text-text-muted">
              <span className="text-foreground font-medium">Backend offline.</span> No HY-ARIA backend answered at <span className="num">{API_BASE}</span>.
              The camera preview works, but photos are only saved and analysed when the backend runs on this computer.
            </p>
          </div>
        )}

        <div className="grid lg:grid-cols-12 gap-4">
          <section className="lg:col-span-7 panel panel-hi p-5">
            <p className="eyebrow mb-3">Capture</p>
            <PlantCamera demo={demo} onSaved={(img) => setImages((prev) => [img, ...prev])} />
          </section>

          <div className="lg:col-span-5 grid gap-4 content-start">
            <section className="panel p-5">
              <p className="eyebrow mb-3">Latest photo</p>
              {latest ? (
                <div className="flex gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${API_BASE}${latest.url}`} alt="Latest plant photo" className="w-28 h-28 rounded-xl object-cover border border-line" />
                  <div className="min-w-0">
                    <ResultChip img={latest} />
                    <p className="text-sm mt-2">Canopy cover <span className="num">{latest.canopy_pct}%</span></p>
                    <p className="text-xs text-faint mt-1">{fmtDate(latest.ts)} {fmtTime(latest.ts)} · day {Math.floor(latest.day)} · {latest.stage}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-text-muted">No photos yet. Capture one to start the timeline.</p>
              )}
            </section>

            <section className="panel p-5">
              <p className="eyebrow mb-3">N/P/K model</p>
              {model?.available && m ? (
                <>
                  <p className="text-sm">
                    YOLO11n-cls, <span className="num">{Math.round(m.eval.accuracy * 100)}%</span> accuracy on{" "}
                    <span className="num">{m.eval.val_images}</span> held-out photos from a public hydroponic lettuce dataset.
                  </p>
                  <p className="text-xs text-faint mt-2 leading-snug">
                    Experimental: small dataset (only {m.split.healthy?.total ?? "?"} healthy photos), not yet tested on our
                    chamber. Results under {Math.round(model.min_confidence * 100)}% confidence are ignored. Two photos in a row must agree
                    before the controller takes the camera into account.
                  </p>
                </>
              ) : (
                <p className="text-sm text-text-muted">{demo ? "Unknown while the backend is offline." : model?.reason ?? "Loading…"}</p>
              )}
            </section>

            <section className="panel p-5">
              <p className="eyebrow mb-1">Canopy cover over time</p>
              <p className="text-xs text-faint mb-3">Share of the photo that is green leaf. Keep the camera at the same height for a fair curve.</p>
              <div className="h-[170px]">
                {curve.length >= 2 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={curve} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
                      <CartesianGrid stroke="var(--c-line)" vertical={false} />
                      <XAxis dataKey="day" stroke="var(--c-faint)" fontSize={10} tickLine={false} axisLine={false} unit="d" />
                      <YAxis domain={[0, 100]} stroke="var(--c-faint)" fontSize={10} tickLine={false} axisLine={false} unit="%" />
                      <Tooltip
                        contentStyle={{ background: "var(--c-card)", border: "1px solid var(--c-line)", borderRadius: 12, fontSize: 12 }}
                        labelFormatter={(_, p) => p?.[0]?.payload?.label ?? ""}
                      />
                      <Line dataKey="canopy" name="Canopy %" stroke="var(--c-leaf)" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-text-muted">Needs at least two photos.</p>
                )}
              </div>
            </section>
          </div>
        </div>

        <section className="mt-4 panel p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="eyebrow">Timeline</p>
            <span className="num text-xs text-faint">{images.length} photos</span>
          </div>
          {!byDay.length && <p className="text-sm text-text-muted">Photos you capture appear here, grouped by day.</p>}
          <div className="space-y-6">
            {byDay.map(([day, imgs]) => (
              <div key={day}>
                <p className="text-sm font-medium mb-2">
                  {fmtDate(imgs[0].ts)} <span className="text-faint font-normal">· day {Math.floor(imgs[0].day)} · {imgs[0].stage}</span>
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                  {imgs.map((img) => (
                    <button key={img.id} onClick={() => setOpen(img)} className="text-left rounded-xl border border-line overflow-hidden hover:border-line-strong transition-colors">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`${API_BASE}${img.url}`} alt={`Plant photo ${fmtTime(img.ts)}`} loading="lazy" className="w-full aspect-square object-cover" />
                      <div className="p-2">
                        <ResultChip img={img} small />
                        <p className="num text-[11px] text-faint mt-1">{fmtTime(img.ts)} · {img.canopy_pct}%</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4" onClick={() => setOpen(null)} role="dialog" aria-modal="true">
          <div className="panel panel-hi max-w-3xl w-full p-4" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${API_BASE}${open.url}`} alt="Plant photo" className="w-full max-h-[60vh] object-contain rounded-xl" />
            <div className="flex flex-wrap items-start justify-between gap-3 mt-3">
              <div>
                <ResultChip img={open} />
                <p className="text-sm mt-2">Canopy cover <span className="num">{open.canopy_pct}%</span>{open.note ? ` · ${open.note}` : ""}</p>
                <p className="text-xs text-faint mt-1">{fmtDate(open.ts)} {fmtTime(open.ts)} · day {Math.floor(open.day)} · {open.stage}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => remove(open)} className="btn btn-ghost px-3 py-2 text-xs"><Trash2 size={14} /> Delete</button>
                <button onClick={() => setOpen(null)} className="btn btn-primary px-4 py-2 text-xs">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function ResultChip({ img, small = false }: { img: PlantImage; small?: boolean }) {
  const npk = img.result?.npk;
  if (!npk?.available || !img.npk_label) return <span className="chip">no model</span>;
  if (npk.low_confidence) return <span className="chip" style={{ color: "var(--c-faint)" }}>unsure · retake</span>;
  const tone = NPK_TONE[img.npk_label] ?? "var(--c-leaf)";
  return (
    <span className="chip" style={{ color: tone, borderColor: `color-mix(in srgb, ${tone} 40%, transparent)` }}>
      {small ? (NPK_TEXT[img.npk_label] ?? img.npk_label).replace(" deficient", " low") : NPK_TEXT[img.npk_label]}
      {" "}{Math.round((img.npk_confidence ?? 0) * 100)}%
    </span>
  );
}

"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, CloudOff, Microscope, ShieldCheck, Upload, X } from "lucide-react";
import { API_BASE } from "@/lib/api";

type Leaf = { class: string; confidence: number; severity: number };
type Result = {
  plant_detected: string;
  disease: string;
  status: "Optimal" | "Warning" | "Critical" | string;
  confidence: number;
  treatment_plan: string;
  precision_data?: {
    total_leaves: number;
    infected_count: number;
    avg_severity_pct: number;
    spray_tier: string;
    dosage_percent: number;
    individual_leaves: Leaf[];
  };
};

const STATUS_TONE: Record<string, string> = { Optimal: "var(--c-leaf)", Warning: "var(--c-amber)", Critical: "var(--c-red)" };

export default function DetectorPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<{ offline: boolean; text: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined) => {
    if (!f || !f.type.startsWith("image/")) return;
    if (preview) URL.revokeObjectURL(preview);
    setFile(f); setPreview(URL.createObjectURL(f)); setResult(null); setError(null);
  };

  const clear = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null); setPreview(null); setResult(null); setError(null);
    if (input.current) input.current.value = "";
  };

  const analyse = async () => {
    if (!file) return;
    setLoading(true); setError(null);
    const body = new FormData();
    body.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/detect-disease`, { method: "POST", body });
      if (!res.ok) {
        const detail = await res.json().then((j) => j.detail).catch(() => null);
        setError({ offline: false, text: detail ?? `Backend answered ${res.status}.` });
        return;
      }
      setResult(await res.json());
    } catch {
      setError({ offline: true, text: `No HY-ARIA backend answered at ${API_BASE}.` });
    } finally {
      setLoading(false);
    }
  };

  const tone = result ? STATUS_TONE[result.status] ?? "var(--c-faint)" : "var(--c-faint)";
  const p = result?.precision_data;

  return (
    <main className="pt-24 pb-16">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
        <div className="mb-6">
          <p className="eyebrow flex items-center gap-2 mb-3"><Microscope size={13} /> Disease Lab · legacy model</p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold">Disease Lab</h1>
          <p className="mt-2 text-text-muted max-w-2xl">
            Upload a leaf photo. A leaf detector finds each leaf, a classifier names the disease, and the share of spotted
            area gives a severity. The advice below is a rule of thumb from that severity; nothing here controls the chamber.
          </p>
        </div>

        <div className="mb-6 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: "color-mix(in srgb, var(--c-amber) 40%, transparent)", background: "color-mix(in srgb, var(--c-amber) 7%, transparent)" }}>
          <AlertTriangle size={18} className="text-accent shrink-0 mt-0.5" />
          <p className="text-text-muted">
            <span className="text-foreground font-medium">This model has no lettuce classes.</span> It was trained on the
            PlantVillage dataset (other crops), so results for lettuce leaves are not reliable. A lettuce disease model is
            planned. For lettuce N/P/K deficiency, use the <Link href="/plants" className="text-primary underline underline-offset-2">plant camera</Link>.
          </p>
        </div>

        <div className="grid lg:grid-cols-12 gap-4">
          {/* ------------------------------------------------ upload */}
          <section className="lg:col-span-7 panel panel-hi p-5">
            <p className="eyebrow mb-3">Leaf photo</p>
            {preview ? (
              <div className="space-y-4">
                <div className="relative rounded-xl overflow-hidden border border-line bg-card-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview} alt="Selected leaf" className="w-full max-h-[460px] object-contain" />
                  {loading && (
                    <div className="absolute inset-0 grid place-items-center bg-background/60 backdrop-blur-sm">
                      <div className="w-10 h-10 rounded-full border-2 border-line border-t-primary animate-spin" />
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={analyse} disabled={loading} className="btn btn-primary disabled:opacity-50">
                    {loading ? "Analysing…" : "Analyse photo"} {!loading && <ArrowRight size={15} />}
                  </button>
                  <button onClick={clear} disabled={loading} className="btn btn-ghost"><X size={15} /> Clear</button>
                  <span className="text-xs text-faint num truncate">{file?.name} · {file ? Math.round(file.size / 1024) : 0} KB</span>
                </div>
              </div>
            ) : (
              <label
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
                className={`grid place-items-center text-center min-h-[340px] rounded-xl border border-dashed cursor-pointer transition-colors ${drag ? "border-primary bg-card-2" : "border-line-strong hover:bg-card-2"}`}
              >
                <div className="px-6">
                  <div className="mx-auto mb-4 w-14 h-14 rounded-full grid place-items-center border border-line bg-card-2">
                    <Upload size={22} className="text-primary" />
                  </div>
                  <p className="font-medium">Drop a leaf photo here, or click to choose one</p>
                  <p className="text-sm text-text-muted mt-1">One leaf, filling most of the frame, in even light.</p>
                </div>
                <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
              </label>
            )}

            {error && (
              <div className="mt-4 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "color-mix(in srgb, var(--c-red) 40%, transparent)", background: "color-mix(in srgb, var(--c-red) 7%, transparent)" }}>
                {error.offline ? <CloudOff size={18} className="text-danger shrink-0 mt-0.5" /> : <AlertTriangle size={18} className="text-danger shrink-0 mt-0.5" />}
                <p className="text-text-muted">
                  <span className="text-foreground font-medium">{error.offline ? "Backend offline." : "Analysis failed."}</span> {error.text}
                  {error.offline && <> Start it with <span className="num text-foreground">python -m uvicorn main:app</span> in the backend folder.</>}
                </p>
              </div>
            )}
          </section>

          {/* ------------------------------------------------ result */}
          <section className="lg:col-span-5 panel p-5 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <p className="eyebrow">Result</p>
              {result && <span className="chip">legacy · not lettuce</span>}
            </div>

            {!result ? (
              <div className="flex-1 grid place-items-center text-center py-12">
                <p className="text-sm text-text-muted max-w-xs">
                  {loading ? "Detecting leaves and classifying…" : "No result yet. Choose a photo and press Analyse."}
                </p>
              </div>
            ) : (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                <div className="flex items-center gap-3 rounded-xl border px-4 py-3" style={{ borderColor: `color-mix(in srgb, ${tone} 40%, transparent)`, background: `color-mix(in srgb, ${tone} 8%, transparent)` }}>
                  {result.status === "Optimal" ? <ShieldCheck size={22} style={{ color: tone }} /> : <AlertTriangle size={22} style={{ color: tone }} />}
                  <div>
                    <p className="font-display text-xl font-semibold" style={{ color: tone }}>{result.status === "Optimal" ? "No disease found" : result.disease}</p>
                    <p className="text-xs text-text-muted">
                      {result.status} · classifier label: {result.plant_detected} – {result.disease}
                      {result.status === "Optimal" && " (spotted area too small to count)"}
                    </p>
                  </div>
                </div>

                <dl className="grid grid-cols-3 gap-2">
                  <Stat label="Model confidence" value={`${Math.round(result.confidence * 100)}%`} />
                  <Stat label="Leaves found" value={p ? `${p.infected_count}/${p.total_leaves} spotted` : "–"} />
                  <Stat label="Severity" value={p ? `${p.avg_severity_pct}%` : "–"} />
                </dl>
                <p className="text-xs text-faint -mt-2">Confidence is the model&apos;s own score for this photo, not a measured accuracy.</p>

                <div className="rounded-xl border border-line bg-card-2 px-4 py-3">
                  <p className="eyebrow mb-1">Suggested action</p>
                  <p className="text-sm">{result.treatment_plan}</p>
                  {p && <p className="text-xs text-faint mt-2">Spray tier {p.spray_tier} ({p.dosage_percent}%). Advice only: there is no spray actuator.</p>}
                </div>

                {p && p.individual_leaves.length > 1 && (
                  <div>
                    <p className="eyebrow mb-2">Per leaf</p>
                    <ul className="divide-y divide-line text-sm">
                      {p.individual_leaves.map((l, i) => (
                        <li key={i} className="flex items-center justify-between gap-3 py-1.5">
                          <span className="truncate text-text-muted">{l.class}</span>
                          <span className="num shrink-0">{Math.round(l.confidence * 100)}% · sev {l.severity.toFixed(1)}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </motion.div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-card-2 px-3 py-2.5">
      <dt className="text-[11px] text-faint">{label}</dt>
      <dd className="num text-sm mt-0.5">{value}</dd>
    </div>
  );
}

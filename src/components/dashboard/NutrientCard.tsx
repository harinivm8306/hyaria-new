"use client";

import { Camera } from "lucide-react";

const ION = [
  { key: "n", sensor: "n_ppm", label: "Nitrogen", sym: "NO₃-N", tone: "var(--c-leaf)" },
  { key: "p", sensor: "p_ppm", label: "Phosphorus", sym: "P", tone: "var(--c-violet)" },
  { key: "k", sensor: "k_ppm", label: "Potassium", sym: "K⁺", tone: "var(--c-amber)" },
] as const;

const STATE_TONE: Record<string, string> = { ok: "var(--c-faint)", low: "var(--c-amber)", high: "var(--c-mist)", unknown: "var(--c-red)" };
const CAM_TEXT: Record<string, string> = {
  healthy: "looks healthy", n_deficient: "sees N deficiency", p_deficient: "sees P deficiency", k_deficient: "sees K deficiency",
};

/** N/P/K from ion-selective sensors vs recipe band, with the camera's opinion and the A16 decision. */
export default function NutrientCard({ readings, stage, npk, demo, real }: {
  readings: Record<string, any>;
  stage: any;
  npk: any;
  demo: boolean;
  real: string[];
}) {
  const status = npk?.status ?? {};
  const cam = npk?.camera ?? {};
  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between mb-1">
        <p className="eyebrow">N · P · K</p>
        <span className="text-[11px] text-faint">ion sensors + camera</span>
      </div>
      <p className="text-xs text-text-muted mb-4">Three stock bottles, one peristaltic pump each. A nutrient is dosed only when its ion sensor reads low.</p>
      <div className="space-y-4">
        {ION.map((ion) => {
          const r = readings[ion.sensor];
          const v: number | null = r?.status === "OK" ? r.value : null;
          const band: number[] | undefined = stage?.npk?.[ion.key];
          const st = status[ion.key];
          const max = band ? band[1] * 1.5 : 300;
          const pct = (x: number) => `${Math.max(0, Math.min(100, (x / max) * 100))}%`;
          const isReal = real.includes(ion.sensor);
          return (
            <div key={ion.key}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm">
                  {ion.label} <span className="text-faint text-xs">{ion.sym}</span>
                  <span className={`chip ml-2 ${demo ? "" : isReal ? "chip-real" : "chip-sim"}`}>{demo ? "demo" : isReal ? "real" : "sim"}</span>
                </span>
                <span className="num text-sm">{v != null ? Math.round(v) : "–"}<span className="text-xs text-text-muted ml-1">ppm</span></span>
              </div>
              <div className="relative h-2 rounded-full bg-card-2 mt-2 overflow-hidden">
                {band && <div className="absolute inset-y-0 rounded-full opacity-25" style={{ left: pct(band[0]), width: `calc(${pct(band[1])} - ${pct(band[0])})`, background: ion.tone }} />}
                {v != null && <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(v), background: ion.tone, opacity: 0.85 }} />}
              </div>
              <p className="text-[11px] mt-1 flex justify-between gap-2" style={{ color: STATE_TONE[st?.state] ?? "var(--c-faint)" }}>
                <span className="truncate">{st?.why ?? (band ? `target ${band[0]}–${band[1]}` : "no target for this crop")}</span>
                {st?.camera_deficient && <span className="flex items-center gap-1 shrink-0"><Camera size={11} /> camera</span>}
              </p>
            </div>
          );
        })}
      </div>
      <div className="mt-4 pt-3 border-t border-line text-[11px] text-faint space-y-1">
        <p>
          <Camera size={11} className="inline mr-1 -mt-0.5" />
          Camera: {cam.label ? `${CAM_TEXT[cam.label] ?? cam.label} (${Math.round((cam.confidence ?? 0) * 100)}%, ${cam.streak} photo${cam.streak === 1 ? "" : "s"} in a row)` : "no confident photo yet"}
        </p>
        <p>{status.note ?? (npk?.mixing_until ? `Mixing ${npk.pending?.toUpperCase()} dose` : "Idle")}</p>
        {npk?.gains && <p className="num">Learned gains · N {npk.gains.n} · P {npk.gains.p} · K {npk.gains.k} ppm per ml/L</p>}
      </div>
    </section>
  );
}

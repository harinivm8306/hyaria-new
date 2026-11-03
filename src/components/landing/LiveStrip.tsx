"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { DEVICE_ID, apiGet } from "@/lib/api";

const metrics = [
  { key: "air_temp", label: "Air", unit: "°C", digits: 1 },
  { key: "humidity", label: "Humidity", unit: "%", digits: 0 },
  { key: "ph", label: "pH", unit: "", digits: 2 },
  { key: "ec", label: "EC", unit: " mS/cm", digits: 2 },
  { key: "water_level", label: "Tank", unit: "%", digits: 0 },
];

export default function LiveStrip() {
  const [live, setLive] = useState<any>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const d = await apiGet(`/api/devices/${DEVICE_ID}/live`, 4000);
        if (!stop) { setLive(d); setOffline(false); }
      } catch {
        if (!stop) setOffline(true);
      }
    };
    load();
    const t = setInterval(load, 6000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  const real: string[] = live?.data_source?.real_sensors ?? [];

  return (
    <div className="glass panel-hi rounded-3xl p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <span className={`live-dot ${offline ? "text-faint" : "text-primary"}`} />
          <span className="eyebrow">{offline ? "Live feed offline" : live ? `Live · ${live.crop_name} · ${live.stage?.name} · day ${Math.floor(live.day)}` : "Connecting…"}</span>
        </div>
        <Link href="/dashboard" className="text-xs text-text-muted hover:text-foreground inline-flex items-center gap-1">Open command centre <ArrowUpRight size={14} /></Link>
      </div>
      {offline ? (
        <p className="text-sm text-text-muted">
          Live readings appear here when the HY-ARIA backend is running on this computer
          (<span className="num text-foreground">python -m uvicorn main:app</span> in the backend folder).
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {metrics.map((m) => {
            const r = live?.readings?.[m.key];
            const isReal = real.includes(m.key);
            return (
              <div key={m.key} className="rounded-2xl bg-card-2/60 border border-line p-4 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-text-muted">{m.label}</span>
                  {live && <span className={`chip ${isReal ? "chip-real" : "chip-sim"}`}>{isReal ? "real" : "sim"}</span>}
                </div>
                <div className="num text-2xl font-semibold mt-2 truncate">
                  {r?.value != null ? r.value.toFixed(m.digits) : "–"}<span className="text-sm text-text-muted">{m.unit}</span>
                </div>
              </div>
            );
          })}
          <div className="rounded-2xl border border-line p-4 min-w-0" style={{ background: "color-mix(in srgb, var(--c-leaf) 8%, transparent)" }}>
            <span className="text-xs text-text-muted">Plant health</span>
            <div className="num text-2xl font-semibold mt-2 text-primary">{live?.health?.score != null ? Math.round(live.health.score) : "–"}<span className="text-sm text-text-muted">/100</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, Beaker, Bot, CheckCircle2, CloudOff, Droplets, FlaskConical, Gauge, Hand, Lightbulb,
  Thermometer, Timer, Waves, Zap,
} from "lucide-react";
import ChamberView from "@/components/three/ChamberView";
import type { FocusKey, Hotspot } from "@/components/three/AeroChamber";
import { API_BASE, DEVICE_ID, apiGet, apiPost } from "@/lib/api";
import { demoActions, demoHistory, demoLive } from "@/components/dashboard/demo";

type Reading = { value: number | null; raw: number | null; status: string; source: string; ts: number };
type Point = { ts: number; value: number | null };

const SENSORS: { key: string; label: string; unit: string; digits: number; icon: any; band?: string; tone: string }[] = [
  { key: "ph", label: "pH", unit: "", digits: 2, icon: FlaskConical, band: "ph", tone: "var(--c-leaf)" },
  { key: "ec", label: "EC", unit: "mS/cm", digits: 2, icon: Beaker, band: "ec", tone: "var(--c-mist)" },
  { key: "air_temp", label: "Air temp", unit: "°C", digits: 1, icon: Thermometer, band: "air_temp", tone: "var(--c-amber)" },
  { key: "humidity", label: "Humidity", unit: "%", digits: 0, icon: Droplets, band: "humidity", tone: "var(--c-mist)" },
  { key: "water_temp", label: "Root zone", unit: "°C", digits: 1, icon: Waves, band: "water_temp", tone: "var(--c-leaf)" },
  { key: "water_level", label: "Tank", unit: "%", digits: 0, icon: Gauge, tone: "var(--c-mist)" },
  { key: "light_lux", label: "Light", unit: "lux", digits: 0, icon: Lightbulb, tone: "var(--c-violet)" },
];

const FOCUS: { key: FocusKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "canopy", label: "Canopy" },
  { key: "roots", label: "Root zone" },
  { key: "reservoir", label: "Reservoir" },
];

const fmtTime = (ts?: number | null) =>
  ts ? new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "–";

const inBand = (v: number | null | undefined, band?: number[]) => v == null || !band || (v >= band[0] && v <= band[1]);

export default function Dashboard() {
  const [live, setLive] = useState<any>(null);
  const [hist, setHist] = useState<Record<string, Point[]>>({});
  const [actions, setActions] = useState<any[]>([]);
  const [hours, setHours] = useState(24);
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [focus, setFocus] = useState<FocusKey>("overview");

  const loadLive = useCallback(async () => {
    try {
      const [l, a] = await Promise.all([
        apiGet(`/api/devices/${DEVICE_ID}/live`, 4000),
        apiGet(`/api/devices/${DEVICE_ID}/actions?limit=30`, 4000),
      ]);
      setLive(l); setActions(a); setDemo(false);
    } catch {
      setDemo(true); setLive(demoLive()); setActions(demoActions());
    }
  }, []);

  const loadHistory = useCallback(async () => {
    if (demo) { setHist(demoHistory(hours)); return; }
    try { setHist(await apiGet(`/api/devices/${DEVICE_ID}/history/all?hours=${hours}`)); }
    catch { setHist(demoHistory(hours)); }
  }, [hours, demo]);

  useEffect(() => { loadLive(); const t = setInterval(loadLive, 5000); return () => clearInterval(t); }, [loadLive]);
  useEffect(() => { loadHistory(); const t = setInterval(loadHistory, 30000); return () => clearInterval(t); }, [loadHistory]);

  const flash = (text: string, ok = true) => { setToast({ text, ok }); setTimeout(() => setToast(null), 4500); };

  const act = async (label: string, fn: () => Promise<any>) => {
    if (demo) { flash("Demo mode: start the HY-ARIA backend on this computer to control the chamber.", false); return; }
    setBusy(label);
    try {
      const r = await fn();
      if (r?.status && r.status !== "done") flash(`${label}: ${r.status}, ${String(r.reason ?? "").split("|").pop()?.trim()}`, false);
      else flash(`${label}: done`);
      await loadLive();
    } catch (e: any) { flash(`${label} failed: ${e.message}`, false); }
    finally { setBusy(null); }
  };
  const override = (actuator: string, amount: number, label: string) =>
    act(label, () => apiPost(`/api/devices/${DEVICE_ID}/override`, { actuator, amount }));

  const rows = useMemo(() => {
    const map = new Map<number, any>();
    for (const [sensor, pts] of Object.entries(hist)) {
      for (const p of pts || []) {
        const k = Math.round(p.ts / 60) * 60;
        const row = map.get(k) || { ts: k, time: fmtTime(k) };
        row[sensor] = p.value;
        map.set(k, row);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
  }, [hist]);

  if (!live) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="w-10 h-10 rounded-full border-2 border-line border-t-primary animate-spin" />
      </div>
    );
  }

  const stage = live.stage;
  const R: Record<string, Reading> = live.readings || {};
  const v = (k: string) => (R[k]?.status === "OK" ? R[k]?.value : null);
  const ctrl = live.controllers || {};
  const src = live.data_source || {};
  const realSensors: string[] = src.real_sensors || (src.name === "thingspeak" ? Object.keys(R) : []);
  const faults: string[] = src.simulator?.faults || src.faults || [];
  const pumpFault = live.alerts?.some((a: any) => a.type === "actuator:mist");
  const nextMist = ctrl.misting?.next_mist_at ? Math.max(0, Math.round(ctrl.misting.next_mist_at - live.time)) : null;
  const mistOn = (v("pump_state") ?? 0) > 0.5 || (nextMist != null && nextMist > 0 && ctrl.misting?.last_mist_at && live.time - ctrl.misting.last_mist_at < 6);

  const chamberState = {
    mistOn: !!mistOn,
    ledPwm: ctrl.lighting?.pwm ?? 0,
    growth: Math.min(1, (live.day ?? 0) / 40),
    waterLevel: v("water_level") ?? 70,
    health: (live.health?.band ?? "Unknown") as any,
    pumpFault,
  };

  const hotspots: Hotspot[] = [
    { id: "canopy", label: "LED", value: `${Math.round(ctrl.lighting?.pwm ?? 0)}%`, position: [0, 2.82, 0.12], tone: "violet" },
    { id: "plants", label: "Canopy", value: stage?.name, position: [0.6, 2.35, 0.25], tone: "leaf" },
    { id: "env", label: "DHT11", value: v("air_temp") != null ? `${v("air_temp")!.toFixed(1)}° · ${Math.round(v("humidity") ?? 0)}%` : "–", position: [-0.98, 2.62, 0.45], tone: "amber" },
    { id: "roots", label: "Mist", value: pumpFault ? "fault" : nextMist != null ? `in ${Math.floor(nextMist / 60)}:${String(nextMist % 60).padStart(2, "0")}` : "–", position: [0.35, 1.25, 0.2], tone: pumpFault ? "red" : "mist" },
    { id: "reservoir", label: "pH · EC", value: v("ph") != null ? `${v("ph")!.toFixed(2)} · ${v("ec")?.toFixed(2)}` : "–", position: [-0.45, 0.62, 0.3], tone: "leaf" },
  ];
  const onHotspot = (id: string) => {
    const map: Record<string, FocusKey> = { canopy: "canopy", plants: "canopy", env: "canopy", roots: "roots", reservoir: "reservoir" };
    setFocus(map[id] ?? "overview");
  };

  const health = live.health || {};
  const healthTone = health.band === "Good" ? "var(--c-leaf)" : health.band === "Watch" ? "var(--c-amber)" : health.band === "Act" ? "var(--c-red)" : "var(--c-faint)";

  return (
    <main className="pt-24 pb-16">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
        {/* ------------------------------------------------ header */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 mb-6">
          <div>
            <p className="eyebrow flex items-center gap-2 mb-3">
              <span className={`live-dot ${demo ? "text-accent" : "text-primary"}`} />
              {demo ? "Demo data · backend offline" : `Live · ${src.name} source`} · {new Date(live.time * 1000).toLocaleString()}
            </p>
            <h1 className="font-display text-4xl sm:text-5xl font-bold">
              Tower 1 <span className="text-text-muted font-medium">· {live.crop_name}</span>
            </h1>
            <p className="mt-2 text-text-muted">
              {stage?.name} stage · day {Math.floor(live.day)} · VPD <span className="num text-foreground">{live.vpd_kpa ?? "–"}</span> kPa
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-full p-1 border border-line bg-card" role="group" aria-label="Control mode">
              {[{ auto: true, label: "Auto", icon: Bot }, { auto: false, label: "Manual", icon: Hand }].map((m) => (
                <button
                  key={m.label}
                  onClick={() => live.auto !== m.auto && act(`Switch to ${m.label.toLowerCase()}`, () => apiPost(`/api/devices/${DEVICE_ID}/mode`, { auto: m.auto }))}
                  className={`relative px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2 transition-colors ${live.auto === m.auto ? "text-foreground" : "text-text-muted hover:text-foreground"}`}
                >
                  {live.auto === m.auto && <motion.span layoutId="mode" className="absolute inset-0 rounded-full bg-card-2 border border-line-strong" />}
                  <m.icon size={15} className="relative" /><span className="relative">{m.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {demo && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: "color-mix(in srgb, var(--c-amber) 40%, transparent)", background: "color-mix(in srgb, var(--c-amber) 7%, transparent)" }}>
            <CloudOff size={18} className="text-accent shrink-0 mt-0.5" />
            <p className="text-text-muted">
              <span className="text-foreground font-medium">You're seeing demo data.</span> No HY-ARIA backend answered at <span className="num">{API_BASE}</span>.
              Start it on this computer with <span className="num text-foreground">python -m uvicorn main:app</span> in the backend folder, and this page switches to live readings automatically.
            </p>
          </div>
        )}

        {/* ------------------------------------------------ twin + health/alerts */}
        <div className="grid lg:grid-cols-12 gap-4">
          <section className="lg:col-span-8 panel panel-hi relative overflow-hidden min-h-[420px] h-[56vh] lg:h-[560px]">
            <div aria-hidden className="absolute inset-0 grid-bg opacity-50" />
            <ChamberView
              state={chamberState}
              focus={focus}
              interactive
              hotspots={hotspots}
              onHotspot={onHotspot}
              fov={33}
              className="absolute inset-0"
            />
            <div className="absolute top-4 left-4 right-4 flex flex-col sm:flex-row items-start justify-between gap-3 pointer-events-none">
              <div>
                <p className="eyebrow">Digital twin</p>
                <p className="hidden sm:block text-sm text-text-muted mt-1">Drag to rotate · scroll to zoom · tap a label</p>
              </div>
              <div className="flex gap-1 p-1 rounded-full glass pointer-events-auto">
                {FOCUS.map((f) => (
                  <button key={f.key} onClick={() => setFocus(f.key)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${focus === f.key ? "bg-card-2 text-foreground border border-line-strong" : "text-text-muted hover:text-foreground"}`}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-2 pointer-events-none">
              <StatusPill icon={Waves} label="Mist" value={pumpFault ? "Pump fault" : mistOn ? "Spraying" : nextMist != null ? `Next in ${Math.floor(nextMist / 60)}m ${nextMist % 60}s` : "–"} tone={pumpFault ? "var(--c-red)" : "var(--c-mist)"} />
              <StatusPill icon={Lightbulb} label="LED" value={`${Math.round(ctrl.lighting?.pwm ?? 0)}%`} tone="var(--c-violet)" />
              <StatusPill icon={Beaker} label="Dosing" value={ctrl.dosing?.mixing_until ? `Mixing (${ctrl.dosing.pending})` : "Idle"} tone="var(--c-leaf)" />
            </div>
          </section>

          <div className="lg:col-span-4 grid gap-4 content-start">
            <section className="panel panel-hi p-6 flex items-center gap-6">
              <HealthRing score={health.score} tone={healthTone} />
              <div className="min-w-0">
                <p className="eyebrow">Plant health</p>
                <p className="font-display text-3xl font-bold mt-1" style={{ color: healthTone }}>{health.band ?? "–"}</p>
                <p className="text-sm text-text-muted mt-1.5 leading-snug">{health.reason}</p>
              </div>
            </section>

            <section className="panel p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="eyebrow">Alerts</p>
                <span className="num text-xs text-faint">{live.alerts?.length ?? 0} active</span>
              </div>
              {!live.alerts?.length ? (
                <div className="flex items-center gap-2 text-sm text-primary py-2"><CheckCircle2 size={16} /> Everything inside safe limits</div>
              ) : (
                <ul className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {live.alerts.map((a: any) => {
                    const tone = a.severity === "critical" ? "var(--c-red)" : "var(--c-amber)";
                    return (
                      <li key={a.id} className="flex gap-3 rounded-xl p-3 border" style={{ borderColor: `color-mix(in srgb, ${tone} 35%, transparent)`, background: `color-mix(in srgb, ${tone} 6%, transparent)` }}>
                        <span className="w-1 rounded-full shrink-0" style={{ background: tone }} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm leading-snug">{a.message}</p>
                          <p className="num text-[11px] text-faint mt-1">since {fmtTime(a.ts)}</p>
                        </div>
                        {!a.acknowledged ? (
                          <button onClick={() => act("Acknowledge", () => apiPost(`/api/alerts/${a.id}/ack`))} className="self-start text-[11px] px-2.5 py-1 rounded-lg border border-line hover:border-line-strong">Ack</button>
                        ) : <span className="self-start text-[11px] text-faint">acked</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="panel p-5 space-y-4">
              <p className="eyebrow">Controllers</p>
              <CtrlRow icon={Timer} label="Misting" value={nextMist != null ? `${Math.floor(nextMist / 60)}m ${nextMist % 60}s` : "–"} sub={ctrl.misting?.why} />
              <CtrlRow icon={Beaker} label="Dosing" value={ctrl.dosing?.mixing_until ? "Mixing" : "Idle"} sub={`Learned gains · nutrient ${ctrl.dosing?.k_ec ?? "–"} · pH-down ${ctrl.dosing?.b_down ?? "–"}`} />
              <div>
                <CtrlRow icon={Lightbulb} label="Daily light" value={ctrl.lighting?.dli_target ? `${ctrl.lighting.dli_so_far} / ${ctrl.lighting.dli_target}` : "–"} sub="mol/m² so far today" />
                {ctrl.lighting?.dli_target ? (
                  <div className="mt-2 h-1.5 rounded-full bg-card-2 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, (ctrl.lighting.dli_so_far / ctrl.lighting.dli_target) * 100)}%`, background: "linear-gradient(90deg, var(--c-violet), var(--c-leaf))" }} />
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </div>

        {/* ------------------------------------------------ sensor tiles */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          {SENSORS.map((s) => {
            const r = R[s.key];
            const band = s.band ? stage?.[s.band] : undefined;
            const ok = r?.status === "OK";
            const good = ok && inBand(r?.value, band);
            const real = realSensors.includes(s.key);
            const series = (hist[s.key] || []).slice(-60).map((p) => ({ v: p.value }));
            const edge = !ok ? "var(--c-red)" : good ? "var(--c-line)" : "var(--c-amber)";
            return (
              <motion.div key={s.key} layout className="panel p-4 min-w-0 relative overflow-hidden" style={{ borderColor: edge }}>
                <div className="flex items-center justify-between gap-2">
                  <s.icon size={15} style={{ color: s.tone }} />
                  <span className={`chip ${demo ? "" : real ? "chip-real" : "chip-sim"}`}>{demo ? "demo" : real ? "real" : "sim"}</span>
                </div>
                <p className="text-xs text-text-muted mt-3">{s.label}</p>
                <p className="num text-2xl font-semibold mt-0.5 truncate">
                  {r?.value != null ? r.value.toFixed(s.digits) : "–"}
                  <span className="text-xs text-text-muted ml-1">{s.unit}</span>
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: !ok ? "var(--c-red)" : good ? "var(--c-faint)" : "var(--c-amber)" }}>
                  {!ok ? r?.status ?? "no data" : band ? `target ${band[0]}–${band[1]}` : " "}
                </p>
                <div className="h-9 -mx-1 mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={series} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}>
                      <defs>
                        <linearGradient id={`sg-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={s.tone} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={s.tone} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <YAxis hide domain={["dataMin", "dataMax"]} />
                      <Area type="monotone" dataKey="v" stroke={s.tone} strokeWidth={1.5} fill={`url(#sg-${s.key})`} isAnimationActive={false} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* ------------------------------------------------ charts + manual control */}
        <div className="mt-4 grid lg:grid-cols-12 gap-4">
          <div className="lg:col-span-8 grid gap-4">
            <ChartPanel title="Nutrient solution" note="Shaded bands are the lettuce targets" hours={hours} setHours={setHours}>
              <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid stroke="var(--c-line)" vertical={false} />
                <XAxis dataKey="time" stroke="var(--c-faint)" fontSize={10} tickLine={false} axisLine={false} minTickGap={48} />
                <YAxis yAxisId="ph" domain={[5.2, 7]} stroke="var(--c-faint)" fontSize={10} tickLine={false} axisLine={false} width={40} />
                <YAxis yAxisId="ec" orientation="right" domain={[0.6, 2.2]} stroke="var(--c-faint)" fontSize={10} tickLine={false} axisLine={false} width={40} />
                {stage && <ReferenceArea yAxisId="ph" y1={stage.ph[0]} y2={stage.ph[1]} fill="var(--c-leaf)" fillOpacity={0.07} />}
                {stage && <ReferenceArea yAxisId="ec" y1={stage.ec[0]} y2={stage.ec[1]} fill="var(--c-mist)" fillOpacity={0.06} />}
                <Tooltip content={<ChartTip />} />
                <Line yAxisId="ph" name="pH" dataKey="ph" stroke="var(--c-leaf)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                <Line yAxisId="ec" name="EC (mS/cm)" dataKey="ec" stroke="var(--c-mist)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              </LineChart>
            </ChartPanel>
            <ChartPanel title="Climate and root zone" note="Temperatures on the left axis, humidity and tank on the right">
              <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid stroke="var(--c-line)" vertical={false} />
                <XAxis dataKey="time" stroke="var(--c-faint)" fontSize={10} tickLine={false} axisLine={false} minTickGap={48} />
                <YAxis yAxisId="t" stroke="var(--c-faint)" fontSize={10} tickLine={false} axisLine={false} width={40} unit="°" />
                <YAxis yAxisId="p" orientation="right" domain={[0, 100]} stroke="var(--c-faint)" fontSize={10} tickLine={false} axisLine={false} width={40} unit="%" />
                <Tooltip content={<ChartTip />} />
                <Line yAxisId="t" name="Air °C" dataKey="air_temp" stroke="var(--c-amber)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                <Line yAxisId="t" name="Root zone °C" dataKey="water_temp" stroke="var(--c-leaf)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                <Line yAxisId="p" name="Humidity %" dataKey="humidity" stroke="var(--c-mist)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                <Line yAxisId="p" name="Tank %" dataKey="water_level" stroke="var(--c-violet)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls isAnimationActive={false} />
              </LineChart>
            </ChartPanel>
          </div>

          <div className="lg:col-span-4 grid gap-4 content-start">
            <section className="panel p-5">
              <div className="flex items-center justify-between mb-1">
                <p className="eyebrow">Manual control</p>
                <Hand size={15} className="text-text-muted" />
              </div>
              <p className="text-xs text-text-muted mb-4">Every command passes the safety interlocks before it runs.</p>
              <div className="grid grid-cols-2 gap-2">
                <CtrlButton busy={busy} label="Mist 5 s" icon={Waves} onClick={() => override("mist", 5, "Mist 5 s")} />
                <CtrlButton busy={busy} label="Add 2 L water" icon={Droplets} onClick={() => override("water_add", 2, "Add 2 L water")} />
                <CtrlButton busy={busy} label="Nutrient A+B 5 ml" icon={Beaker} onClick={async () => { await override("dose_a", 5, "Dose A 5 ml"); await override("dose_b", 5, "Dose B 5 ml"); }} />
                <CtrlButton busy={busy} label="pH down 2 ml" icon={FlaskConical} onClick={() => override("ph_down", 2, "pH down 2 ml")} />
                <CtrlButton busy={busy} label="pH up 2 ml" icon={FlaskConical} onClick={() => override("ph_up", 2, "pH up 2 ml")} />
                <CtrlButton busy={busy} label="LED off" icon={Lightbulb} onClick={() => override("led", 0, "LED off")} />
              </div>
            </section>

            {(src.name === "simulator" || src.name === "hybrid" || demo) && (
              <section className="panel p-5">
                <div className="flex items-center justify-between mb-1">
                  <p className="eyebrow">Fault drill</p>
                  <Zap size={15} className="text-text-muted" />
                </div>
                <p className="text-xs text-text-muted mb-4">Inject a fault into the simulated parts and watch alerts and safety respond.</p>
                <div className="grid grid-cols-2 gap-2">
                  {[["pump_fail", "Pump failure"], ["ph_stuck", "pH probe stuck"], ["leak", "Tank leak"], ["heatwave", "Heatwave"]].map(([f, label]) => {
                    const on = faults.includes(f);
                    return (
                      <button key={f} disabled={!!busy}
                        onClick={() => act(`${label} ${on ? "off" : "on"}`, () => apiPost(`/api/sim/fault`, { fault: f, on: !on }))}
                        className="rounded-xl px-3 py-2.5 text-xs font-medium border transition-colors text-left"
                        style={on ? { borderColor: "var(--c-red)", color: "var(--c-red)", background: "color-mix(in srgb, var(--c-red) 8%, transparent)" } : { borderColor: "var(--c-line)" }}>
                        {label}{on ? " · on" : ""}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        </div>

        {/* ------------------------------------------------ action log */}
        <section className="mt-4 panel p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="eyebrow">Decision log</p>
            <span className="text-xs text-faint">What the system did, and why</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-faint">
                  <th className="py-2 pr-4 font-medium">Time</th><th className="pr-4 font-medium">Action</th><th className="pr-4 font-medium">By</th><th className="pr-4 font-medium">Result</th><th className="font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {actions.slice(0, 14).map((a) => {
                  const tone = a.status === "done" ? "var(--c-leaf)" : a.status === "advisory" ? "var(--c-mist)" : "var(--c-red)";
                  return (
                    <tr key={a.id} className="border-t border-line align-top">
                      <td className="py-2.5 pr-4 num text-xs text-text-muted whitespace-nowrap">{fmtTime(a.ts)}</td>
                      <td className="pr-4 whitespace-nowrap font-medium">{a.actuator.replace("_", " ")} <span className="num text-text-muted">{a.amount}{a.unit}</span></td>
                      <td className="pr-4 text-text-muted">{a.source === "ai" ? "auto" : a.source}</td>
                      <td className="pr-4"><span className="chip" style={{ color: tone, borderColor: `color-mix(in srgb, ${tone} 40%, transparent)` }}>{a.status}</span></td>
                      <td className="text-text-muted text-xs leading-relaxed">{a.reason}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 glass rounded-2xl px-5 py-3 text-sm max-w-md flex items-start gap-2.5"
            role="status"
          >
            {toast.ok ? <CheckCircle2 size={16} className="text-primary mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="text-accent mt-0.5 shrink-0" />}
            <span>{toast.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

// ---------------------------------------------------------------- small components

function HealthRing({ score, tone }: { score?: number | null; tone: string }) {
  const r = 42, c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="relative w-28 h-28 shrink-0">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--c-line)" strokeWidth="7" />
        <motion.circle
          cx="50" cy="50" r={r} fill="none" stroke={tone} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          style={{ filter: `drop-shadow(0 0 6px ${tone})` }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="num text-3xl font-semibold">{score == null ? "–" : Math.round(score)}</span>
      </div>
    </div>
  );
}

function StatusPill({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: string }) {
  return (
    <div className="glass rounded-full pl-2.5 pr-3.5 py-1.5 flex items-center gap-2 text-xs">
      <Icon size={14} style={{ color: tone }} />
      <span className="text-text-muted">{label}</span>
      <span className="num text-foreground">{value}</span>
    </div>
  );
}

function CtrlRow({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm text-text-muted"><Icon size={15} /> {label}</span>
        <span className="num text-sm text-foreground">{value}</span>
      </div>
      {sub && <p className="text-[11px] text-faint mt-1 leading-snug">{sub}</p>}
    </div>
  );
}

function CtrlButton({ label, icon: Icon, onClick, busy }: { label: string; icon: any; onClick: () => void; busy: string | null }) {
  return (
    <motion.button
      whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}
      disabled={!!busy} onClick={onClick}
      className="rounded-xl px-3 py-3 text-xs font-medium border border-line bg-card-2/50 hover:border-primary/60 hover:text-primary transition-colors flex items-center gap-2 disabled:opacity-50 text-left"
    >
      <Icon size={14} className="shrink-0" /> {label}
    </motion.button>
  );
}

function ChartPanel({ title, note, children, hours, setHours }: { title: string; note?: string; children: React.ReactElement; hours?: number; setHours?: (h: number) => void }) {
  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <p className="font-display text-lg font-bold">{title}</p>
          {note && <p className="text-xs text-faint mt-0.5">{note}</p>}
        </div>
        {setHours && (
          <div className="flex gap-1 p-1 rounded-full border border-line">
            {[6, 24, 72].map((h) => (
              <button key={h} onClick={() => setHours(h)} className={`px-3 py-1 rounded-full text-xs num ${hours === h ? "bg-card-2 text-foreground" : "text-text-muted"}`}>{h}h</button>
            ))}
          </div>
        )}
      </div>
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </section>
  );
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass rounded-xl px-3 py-2 text-xs">
      <p className="num text-faint mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.stroke }} />
          <span className="text-text-muted">{p.name}</span>
          <span className="num text-foreground ml-auto">{typeof p.value === "number" ? p.value.toFixed(2) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

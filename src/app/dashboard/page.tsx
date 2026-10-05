"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Section from "@/components/Section";
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, Legend,
} from "recharts";
import {
    Thermometer, Droplets, Waves, Zap, ShieldCheck, AlertTriangle, RefreshCw, Sprout,
    FlaskConical, Gauge, Lightbulb, Timer, Hand, Bot, CloudOff, CheckCircle2, Beaker, Database,
} from "lucide-react";
import { API_BASE, DEVICE_ID, apiGet, apiPost } from "@/lib/api";

type Reading = { value: number | null; raw: number | null; status: string; source: string; ts: number };
type Live = any;
type Point = { ts: number; value: number | null };

const SENSOR_META: Record<string, { label: string; unit: string; digits: number; icon: React.ReactNode; band?: string }> = {
    ph: { label: "pH", unit: "", digits: 2, icon: <FlaskConical />, band: "ph" },
    ec: { label: "EC", unit: " mS/cm", digits: 2, icon: <Beaker />, band: "ec" },
    water_temp: { label: "Water temp", unit: "°C", digits: 1, icon: <Waves />, band: "water_temp" },
    air_temp: { label: "Air temp", unit: "°C", digits: 1, icon: <Thermometer />, band: "air_temp" },
    humidity: { label: "Humidity", unit: "%", digits: 0, icon: <Droplets />, band: "humidity" },
    water_level: { label: "Tank level", unit: "%", digits: 0, icon: <Gauge /> },
    light_lux: { label: "Light", unit: " lux", digits: 0, icon: <Lightbulb /> },
};

const COLORS = { ph: "#10b981", ec: "#3b82f6", air: "#3498db", water: "#2ecc71", hum: "#9b59b6", level: "#f59e0b" };

function fmtTime(ts?: number | null) {
    if (!ts) return "--";
    return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function inBand(v: number | null | undefined, band?: number[]) {
    if (v == null || !band) return true;
    return v >= band[0] && v <= band[1];
}

export default function Dashboard() {
    const [live, setLive] = useState<Live | null>(null);
    const [hist, setHist] = useState<Record<string, Point[]>>({});
    const [actions, setActions] = useState<any[]>([]);
    const [hours, setHours] = useState(24);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [toast, setToast] = useState<string | null>(null);

    const loadLive = useCallback(async () => {
        try {
            const [l, a] = await Promise.all([
                apiGet(`/api/devices/${DEVICE_ID}/live`),
                apiGet(`/api/devices/${DEVICE_ID}/actions?limit=25`),
            ]);
            setLive(l);
            setActions(a);
            setError(null);
        } catch (e: any) {
            setError(`Cannot reach the HY-ARIA backend at ${API_BASE}. Start it with: cd backend && python -m uvicorn main:app`);
        }
    }, []);

    const loadHistory = useCallback(async () => {
        try {
            setHist(await apiGet(`/api/devices/${DEVICE_ID}/history/all?hours=${hours}`));
        } catch { /* live error already shown */ }
    }, [hours]);

    useEffect(() => {
        loadLive();
        const t = setInterval(loadLive, 5000);
        return () => clearInterval(t);
    }, [loadLive]);

    useEffect(() => {
        loadHistory();
        const t = setInterval(loadHistory, 30000);
        return () => clearInterval(t);
    }, [loadHistory]);

    const act = async (label: string, fn: () => Promise<any>) => {
        setBusy(label);
        try {
            const r = await fn();
            if (r?.status && r.status !== "done") setToast(`${label}: ${r.status} — ${r.reason?.split("|").pop()?.trim()}`);
            else setToast(`${label}: done`);
            await loadLive();
        } catch (e: any) {
            setToast(`${label} failed: ${e.message}`);
        } finally {
            setBusy(null);
            setTimeout(() => setToast(null), 5000);
        }
    };
    const override = (actuator: string, amount: number, label: string) =>
        act(label, () => apiPost(`/api/devices/${DEVICE_ID}/override`, { actuator, amount }));

    // Merge per-sensor series into rows for the charts
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

    if (!live && !error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <RefreshCw className="animate-spin text-primary" size={48} />
            </div>
        );
    }

    const stage = live?.stage;
    const readings: Record<string, Reading> = live?.readings || {};
    const health = live?.health || {};
    const ctrl = live?.controllers || {};
    const src = live?.data_source || {};
    const realSensors: string[] = src.real_sensors || (src.name === "thingspeak" ? Object.keys(readings) : []);
    const isSim = src.name === "simulator" || src.name === "hybrid";
    const healthColor = health.band === "Good" ? "text-emerald-400" : health.band === "Watch" ? "text-amber-400" : "text-red-400";
    const nextMistIn = ctrl.misting?.next_mist_at && live ? Math.max(0, Math.round(ctrl.misting.next_mist_at - live.time)) : null;

    return (
        <main className="pt-24 pb-12 min-h-screen bg-background text-foreground">
            <Section>
                {/* Header */}
                <div className="flex flex-col md:flex-row justify-between md:items-end mb-10 gap-6">
                    <div className="space-y-3">
                        <div className="flex items-center gap-3 flex-wrap">
                            <span className={`w-2.5 h-2.5 rounded-full ${error ? "bg-red-500" : "bg-primary animate-pulse"}`} />
                            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">
                                {error ? "Backend offline" : `Control loop live · ${src.name}`}
                            </span>
                            {src.thingspeak?.last_error && (
                                <span className="text-[10px] font-bold text-amber-400 flex items-center gap-1">
                                    <CloudOff size={12} /> ThingSpeak: {src.thingspeak.last_error.slice(0, 60)}
                                </span>
                            )}
                        </div>
                        <h1 className="text-5xl md:text-6xl font-black tracking-tight uppercase italic">
                            HY-ARIA <span className="text-primary not-italic">Dashboard</span>
                        </h1>
                        {live && (
                            <p className="text-sm font-semibold text-text-muted flex flex-wrap items-center gap-4">
                                <span className="flex items-center gap-1.5"><Sprout size={14} /> {live.crop_name} · {stage?.name} · day {Math.floor(live.day)}</span>
                                <span className="flex items-center gap-1.5"><Database size={14} /> {live.device_id}</span>
                                <span>{new Date(live.time * 1000).toLocaleString()}</span>
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        {live && (
                            <button
                                onClick={() => act(live.auto ? "Switch to manual" : "Switch to auto",
                                    () => apiPost(`/api/devices/${DEVICE_ID}/mode`, { auto: !live.auto }))}
                                className={`px-5 py-3 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center gap-2 border transition-all ${live.auto ? "bg-primary/15 border-primary/30 text-primary" : "bg-amber-500/10 border-amber-500/30 text-amber-400"}`}
                            >
                                {live.auto ? <Bot size={16} /> : <Hand size={16} />} {live.auto ? "Auto control" : "Manual mode"}
                            </button>
                        )}
                    </div>
                </div>

                {error && (
                    <div className="glass p-6 rounded-3xl border border-red-500/30 bg-red-500/5 mb-8 text-sm font-semibold flex items-center gap-3">
                        <AlertTriangle className="text-red-400 shrink-0" /> {error}
                    </div>
                )}
                {toast && (
                    <div className="fixed bottom-6 right-6 z-50 glass px-5 py-4 rounded-2xl border border-primary/30 text-sm font-semibold max-w-md">{toast}</div>
                )}

                {live && (
                    <>
                        {/* Health + alerts */}
                        <div className="grid lg:grid-cols-3 gap-6 mb-6">
                            <div className="glass p-8 rounded-[2rem] flex items-center gap-6">
                                <div className={`text-6xl font-black ${healthColor}`}>{health.score != null ? Math.round(health.score) : "--"}</div>
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-widest text-text-muted">Plant health</div>
                                    <div className={`text-2xl font-black ${healthColor}`}>{health.band}</div>
                                    <div className="text-sm text-text-muted mt-1">{health.reason}</div>
                                </div>
                            </div>
                            <div className="glass p-8 rounded-[2rem] lg:col-span-2">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-[10px] font-black uppercase tracking-widest text-text-muted">Active alerts</h3>
                                    <span className="text-xs font-bold text-text-muted">{live.alerts.length}</span>
                                </div>
                                {live.alerts.length === 0 ? (
                                    <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm"><CheckCircle2 size={18} /> All clear</div>
                                ) : (
                                    <ul className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                        {live.alerts.map((a: any) => (
                                            <li key={a.id} className={`flex items-start justify-between gap-3 p-3 rounded-xl border ${a.severity === "critical" ? "border-red-500/30 bg-red-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
                                                <div className="flex gap-2 text-sm">
                                                    <AlertTriangle size={16} className={`shrink-0 mt-0.5 ${a.severity === "critical" ? "text-red-400" : "text-amber-400"}`} />
                                                    <span><span className="font-bold">{a.message}</span> <span className="text-text-muted text-xs">since {fmtTime(a.ts)}</span></span>
                                                </div>
                                                {!a.acknowledged ? (
                                                    <button onClick={() => act("Acknowledge", () => apiPost(`/api/alerts/${a.id}/ack`))}
                                                        className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 shrink-0">Ack</button>
                                                ) : <span className="text-[10px] text-text-muted shrink-0">acked</span>}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>

                        {/* Sensor cards */}
                        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4 mb-6">
                            {Object.entries(SENSOR_META).map(([key, m]) => {
                                const r = readings[key];
                                const band = m.band ? stage?.[m.band] : undefined;
                                const ok = r?.status === "OK";
                                const good = ok && inBand(r?.value, band);
                                const real = realSensors.includes(key);
                                return (
                                    <div key={key} className={`glass p-5 rounded-[1.5rem] border ${!ok ? "border-red-500/40" : good ? "border-white/5" : "border-amber-500/40"}`}>
                                        <div className="flex items-center justify-between mb-3">
                                            <span className="text-text-muted [&>svg]:w-4 [&>svg]:h-4">{m.icon}</span>
                                            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${real ? "bg-emerald-500/15 text-emerald-400" : "bg-blue-500/15 text-blue-400"}`}>
                                                {real ? "real" : "sim"}
                                            </span>
                                        </div>
                                        <div className="text-[10px] font-black uppercase tracking-widest text-text-muted">{m.label}</div>
                                        <div className="text-2xl font-black mt-1">
                                            {r?.value != null ? r.value.toFixed(m.digits) : "--"}<span className="text-sm text-text-muted">{m.unit}</span>
                                        </div>
                                        <div className="text-[10px] text-text-muted mt-1">
                                            {!ok ? <span className="text-red-400 font-bold">{r?.status || "no data"}</span> : band ? `target ${band[0]}–${band[1]}` : " "}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="grid lg:grid-cols-3 gap-6">
                            {/* Charts */}
                            <div className="lg:col-span-2 space-y-6">
                                <div className="flex gap-2">
                                    {[6, 24, 72].map((h) => (
                                        <button key={h} onClick={() => setHours(h)}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-black ${hours === h ? "bg-primary text-white" : "glass text-text-muted"}`}>{h} h</button>
                                    ))}
                                </div>
                                <ChartCard title="Nutrient solution" note="Shaded areas are the recipe target bands">
                                    <LineChart data={rows}>
                                        <CartesianGrid strokeDasharray="4 4" stroke="var(--grid-color)" vertical={false} />
                                        <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={10} minTickGap={40} />
                                        <YAxis yAxisId="ph" domain={[5, 7.5]} stroke={COLORS.ph} fontSize={10} width={36} />
                                        <YAxis yAxisId="ec" orientation="right" domain={[0, 2.5]} stroke={COLORS.ec} fontSize={10} width={36} />
                                        {stage && <ReferenceArea yAxisId="ph" y1={stage.ph[0]} y2={stage.ph[1]} fill={COLORS.ph} fillOpacity={0.08} />}
                                        {stage && <ReferenceArea yAxisId="ec" y1={stage.ec[0]} y2={stage.ec[1]} fill={COLORS.ec} fillOpacity={0.08} />}
                                        <Tooltip contentStyle={{ backgroundColor: "var(--card-bg)", border: "1px solid var(--glass-border)", borderRadius: 12 }} />
                                        <Legend />
                                        <Line yAxisId="ph" name="pH" dataKey="ph" stroke={COLORS.ph} strokeWidth={2} dot={false} connectNulls />
                                        <Line yAxisId="ec" name="EC (mS/cm)" dataKey="ec" stroke={COLORS.ec} strokeWidth={2} dot={false} connectNulls />
                                    </LineChart>
                                </ChartCard>
                                <ChartCard title="Climate and root zone">
                                    <LineChart data={rows}>
                                        <CartesianGrid strokeDasharray="4 4" stroke="var(--grid-color)" vertical={false} />
                                        <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={10} minTickGap={40} />
                                        <YAxis yAxisId="t" stroke="var(--text-muted)" fontSize={10} width={36} unit="°" />
                                        <YAxis yAxisId="p" orientation="right" domain={[0, 100]} stroke="var(--text-muted)" fontSize={10} width={36} unit="%" />
                                        <Tooltip contentStyle={{ backgroundColor: "var(--card-bg)", border: "1px solid var(--glass-border)", borderRadius: 12 }} />
                                        <Legend />
                                        <Line yAxisId="t" name="Air °C" dataKey="air_temp" stroke={COLORS.air} strokeWidth={2} dot={false} connectNulls />
                                        <Line yAxisId="t" name="Water °C" dataKey="water_temp" stroke={COLORS.water} strokeWidth={2} dot={false} connectNulls />
                                        <Line yAxisId="p" name="Humidity %" dataKey="humidity" stroke={COLORS.hum} strokeWidth={2} dot={false} connectNulls />
                                        <Line yAxisId="p" name="Tank %" dataKey="water_level" stroke={COLORS.level} strokeWidth={2} dot={false} connectNulls />
                                    </LineChart>
                                </ChartCard>

                                {/* Action log */}
                                <div className="glass p-6 rounded-[2rem]">
                                    <h3 className="text-[10px] font-black uppercase tracking-widest text-text-muted mb-4">What the system did</h3>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs">
                                            <thead className="text-text-muted text-left">
                                                <tr><th className="py-2 pr-3">Time</th><th className="pr-3">Action</th><th className="pr-3">By</th><th className="pr-3">Status</th><th>Why</th></tr>
                                            </thead>
                                            <tbody>
                                                {actions.map((a) => (
                                                    <tr key={a.id} className="border-t border-white/5 align-top">
                                                        <td className="py-2 pr-3 whitespace-nowrap">{fmtTime(a.ts)}</td>
                                                        <td className="pr-3 whitespace-nowrap font-bold">{a.actuator} {a.amount}{a.unit}</td>
                                                        <td className="pr-3">{a.source}</td>
                                                        <td className={`pr-3 font-bold ${a.status === "done" ? "text-emerald-400" : a.status === "advisory" ? "text-blue-400" : "text-red-400"}`}>{a.status}</td>
                                                        <td className="text-text-muted">{a.reason}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>

                            {/* Right column: controllers + manual control */}
                            <div className="space-y-6">
                                <div className="glass p-6 rounded-[2rem] border border-primary/20 bg-primary/5 space-y-4">
                                    <h3 className="text-lg font-black flex items-center gap-2"><ShieldCheck className="text-primary" size={20} /> Controllers</h3>
                                    <Row icon={<Timer size={16} />} label="Next mist" value={nextMistIn != null ? `${Math.floor(nextMistIn / 60)}m ${nextMistIn % 60}s` : "--"} sub={ctrl.misting?.why} />
                                    <Row icon={<Beaker size={16} />} label="Dosing"
                                        value={ctrl.dosing?.mixing_until ? `mixing (${ctrl.dosing.pending})` : "idle"}
                                        sub={`learned gains: nutrient ${ctrl.dosing?.k_ec}, pH-down ${ctrl.dosing?.b_down}, pH-up ${ctrl.dosing?.b_up}`} />
                                    <Row icon={<Lightbulb size={16} />} label="LED"
                                        value={ctrl.lighting?.pwm != null ? `${ctrl.lighting.pwm}%` : "--"}
                                        sub={ctrl.lighting?.dli_target ? `DLI ${ctrl.lighting.dli_so_far} of ${ctrl.lighting.dli_target} mol/m²/day` : undefined} />
                                    <Row icon={<Droplets size={16} />} label="VPD" value={live.vpd_kpa != null ? `${live.vpd_kpa} kPa` : "--"} />
                                    {live.notes?.length > 0 && <p className="text-xs text-text-muted italic">{live.notes.join(" · ")}</p>}
                                </div>

                                <div className="glass p-6 rounded-[2rem] space-y-3">
                                    <h3 className="text-lg font-black flex items-center gap-2"><Hand size={20} className="text-amber-400" /> Manual control</h3>
                                    <p className="text-xs text-text-muted">Every command passes the safety interlocks first.</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        <Btn busy={busy} label="Mist 5 s" onClick={() => override("mist", 5, "Mist 5 s")} />
                                        <Btn busy={busy} label="Add water 2 L" onClick={() => override("water_add", 2, "Add water 2 L")} />
                                        <Btn busy={busy} label="Nutrient A+B 5 ml" onClick={async () => {
                                            await override("dose_a", 5, "Dose A 5 ml");
                                            await override("dose_b", 5, "Dose B 5 ml");
                                        }} />
                                        <Btn busy={busy} label="pH down 2 ml" onClick={() => override("ph_down", 2, "pH down 2 ml")} />
                                        <Btn busy={busy} label="pH up 2 ml" onClick={() => override("ph_up", 2, "pH up 2 ml")} />
                                        <Btn busy={busy} label="LED off" onClick={() => override("led", 0, "LED off")} />
                                    </div>
                                </div>

                                {isSim && (
                                    <div className="glass p-6 rounded-[2rem] space-y-3">
                                        <h3 className="text-sm font-black uppercase tracking-widest text-text-muted flex items-center gap-2"><Zap size={16} /> Demo: inject a fault</h3>
                                        <p className="text-xs text-text-muted">Shows how alerts and safety respond. Affects only simulated parts.</p>
                                        <div className="grid grid-cols-2 gap-2">
                                            {[["pump_fail", "Pump failure"], ["ph_stuck", "pH probe stuck"], ["leak", "Tank leak"], ["heatwave", "Heatwave"]].map(([f, label]) => {
                                                const on = (src.simulator?.faults || src.faults || []).includes(f);
                                                return (
                                                    <button key={f} disabled={!!busy}
                                                        onClick={() => act(`${label} ${on ? "off" : "on"}`, () => apiPost(`/api/sim/fault`, { fault: f, on: !on }))}
                                                        className={`px-3 py-2 rounded-xl text-xs font-bold border ${on ? "bg-red-500/15 border-red-500/40 text-red-400" : "bg-white/5 border-white/10"}`}>
                                                        {label}{on ? " (on)" : ""}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </Section>
        </main>
    );
}

function ChartCard({ title, note, children }: { title: string; note?: string; children: React.ReactElement }) {
    return (
        <div className="glass p-6 rounded-[2rem]">
            <div className="flex justify-between items-baseline mb-4">
                <h3 className="text-sm font-black uppercase tracking-widest">{title}</h3>
                {note && <span className="text-[10px] text-text-muted">{note}</span>}
            </div>
            <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
            </div>
        </div>
    );
}

function Row({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
    return (
        <div>
            <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-text-muted">{icon} {label}</span>
                <span className="font-black">{value}</span>
            </div>
            {sub && <p className="text-[11px] text-text-muted mt-0.5">{sub}</p>}
        </div>
    );
}

function Btn({ label, onClick, busy }: { label: string; onClick: () => void; busy: string | null }) {
    return (
        <button disabled={!!busy} onClick={onClick}
            className="px-3 py-2.5 rounded-xl text-xs font-bold bg-white/5 hover:bg-primary/15 hover:text-primary border border-white/10 disabled:opacity-50 transition-all">
            {label}
        </button>
    );
}

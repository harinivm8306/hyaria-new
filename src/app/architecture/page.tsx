import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowRight, BrainCircuit, Cpu, Database, LayoutDashboard, Network, Server } from "lucide-react";

// What each part really is today: REAL hardware/data, SIM (simulated in software), PLANNED (not built yet)
type Status = "real" | "sim" | "planned";
type Part = { name: string; detail: string; status: Status };

const LAYERS: { key: string; title: string; icon: typeof Cpu; parts: Part[] }[] = [
  {
    key: "hw", title: "Chamber hardware", icon: Cpu,
    parts: [
      { name: "DHT11", detail: "air temperature + humidity", status: "real" },
      { name: "Arduino Nano + 16×2 LCD", detail: "sensor node, local display", status: "real" },
      { name: "ESP32", detail: "Wi-Fi gateway, pump control", status: "real" },
      { name: "Mist pump", detail: "via motor driver, 12 V supply", status: "real" },
      { name: "pH, EC, N/P/K ions, level, light", detail: "sensors not bought yet", status: "sim" },
      { name: "Dosing pumps A/B, pH, N/P/K", detail: "peristaltic, via relay", status: "sim" },
    ],
  },
  {
    key: "in", title: "Data in", icon: Network,
    parts: [
      { name: "ThingSpeak channel", detail: "humidity, air + water temp, pump state; polled every 20 s", status: "real" },
      { name: "Simulator", detail: "virtual tank that reacts to every command", status: "sim" },
      { name: "Hybrid source", detail: "real ThingSpeak values + simulated rest", status: "real" },
      { name: "ESP32 → /api/ingest", detail: "direct HTTP/MQTT link, command queue", status: "planned" },
    ],
  },
  {
    key: "engine", title: "Control engine", icon: Server,
    parts: [
      { name: "Python · FastAPI", detail: "control loop runs in a thread, ticks every 5 s", status: "real" },
      { name: "SQLite · SQLAlchemy", detail: "readings, actions, alerts, crop cycles, photos", status: "real" },
      { name: "Safety layer (A12)", detail: "every AI or manual command checked against limits", status: "real" },
    ],
  },
  {
    key: "ai", title: "Models", icon: BrainCircuit,
    parts: [
      { name: "N/P/K photo classifier", detail: "YOLO11n-cls, ONNX; 93% on 42 held-out photos (experimental)", status: "real" },
      { name: "Disease model (legacy)", detail: "PlantVillage classes, no lettuce", status: "real" },
      { name: "Chat assistant", detail: "Ollama llama3, runs locally", status: "real" },
      { name: "Lettuce disease model, forecasting, DQN", detail: "researched, not built", status: "planned" },
    ],
  },
  {
    key: "ui", title: "Web app", icon: LayoutDashboard,
    parts: [
      { name: "Command centre", detail: "live readings, 3D twin, controls, action log", status: "real" },
      { name: "Plant camera", detail: "photo timeline, canopy %, N/P/K check", status: "real" },
      { name: "Disease Lab", detail: "leaf photo → legacy disease model", status: "real" },
      { name: "Next.js on Vercel", detail: "shows labelled demo data when no backend answers", status: "real" },
    ],
  },
];

const TICK: { id: string; name: string; what: string; file: string }[] = [
  { id: "A1", name: "Clean", what: "Reject spikes and stuck or out-of-range values; smooth the rest.", file: "sensing.py" },
  { id: "A5", name: "Recipe stage", what: "Pick lettuce targets (pH, EC, N/P/K, temp, humidity, light) for today's growth stage.", file: "recipes.py" },
  { id: "A2", name: "pH + EC dosing", what: "Dose nutrient A+B or pH up/down, wait for mixing, learn how strongly the tank responds.", file: "control/dosing.py" },
  { id: "A16", name: "N/P/K balance", what: "Dose the single nutrient an ion sensor reads low; a camera result only adds weight, never doses alone.", file: "control/npk.py" },
  { id: "A3", name: "Misting", what: "Spray interval from the vapour-pressure deficit (VPD): drier air means shorter gaps.", file: "control/misting.py" },
  { id: "A4", name: "Lighting", what: "LED level needed to reach the day's light target (DLI) in the hours left.", file: "control/lighting.py" },
  { id: "A12", name: "Safety", what: "Block any command over its limit (dose size, doses per hour, spray length).", file: "control/safety.py" },
  { id: "A6", name: "Alerts", what: "Raise and clear alerts: out of range, sensor missing, pump not responding.", file: "alerts.py" },
  { id: "A7", name: "Health score", what: "One 0–100 score with the reason, shown on the dashboard.", file: "health.py" },
];

const STACK: [string, string][] = [
  ["Frontend", "Next.js 16, React 19, TypeScript, Tailwind 4"],
  ["3D + motion", "React Three Fiber, three.js, GLSL shaders, GSAP"],
  ["Charts", "Recharts"],
  ["Backend", "Python 3.10+, FastAPI, SQLAlchemy 2, SQLite"],
  ["Vision", "onnxruntime (N/P/K), TensorFlow + ultralytics (legacy)"],
  ["Firmware", "Arduino C++ on Nano + ESP32"],
];

export default function ArchitecturePage() {
  return (
    <main className="pt-24 pb-16">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
        <div className="mb-8">
          <p className="eyebrow flex items-center gap-2 mb-3"><Network size={13} /> How it fits together</p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold">System architecture</h1>
          <p className="mt-2 text-text-muted max-w-2xl">
            Sensors in the chamber feed a Python control engine that keeps the lettuce recipe, checks every command for
            safety and logs why it acted. The web app shows the same data and lets you take over by hand.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-text-muted items-center">
            <StatusChip status="real" /> built and running
            <StatusChip status="sim" /> simulated until the part is bought
            <StatusChip status="planned" /> designed, not built
          </div>
        </div>

        {/* ------------------------------------------------ layer diagram */}
        <section className="grid lg:grid-cols-[repeat(5,minmax(0,1fr))] gap-3 lg:gap-0 items-stretch">
          {LAYERS.map((layer, i) => (
            <div key={layer.key} className="flex flex-col lg:flex-row items-stretch">
              <div className={`panel ${layer.key === "engine" ? "panel-hi" : ""} p-4 flex-1 min-w-0`}>
                <div className="flex items-center gap-2 mb-3">
                  <layer.icon size={16} className="text-primary" />
                  <p className="eyebrow">{i + 1} · {layer.title}</p>
                </div>
                <ul className="space-y-2.5">
                  {layer.parts.map((p) => (
                    <li key={p.name}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium leading-snug">{p.name}</span>
                        <StatusChip status={p.status} />
                      </div>
                      <p className="text-xs text-text-muted mt-0.5">{p.detail}</p>
                    </li>
                  ))}
                </ul>
              </div>
              {i < LAYERS.length - 1 && (
                <div className="grid place-items-center py-1 lg:py-0 lg:px-1 text-faint" aria-hidden>
                  <ArrowDown size={16} className="lg:hidden" />
                  <ArrowRight size={16} className="hidden lg:block" />
                </div>
              )}
            </div>
          ))}
        </section>
        <p className="text-xs text-faint mt-3">
          Commands flow back the other way: engine → safety check → data source → pump. Until the ESP32 link is built,
          commands for real hardware are logged as advice to carry out by hand.
        </p>

        <div className="grid lg:grid-cols-12 gap-4 mt-8">
          {/* ------------------------------------------------ one tick */}
          <section className="lg:col-span-7 panel p-5">
            <p className="eyebrow mb-1">One control tick (every 5 s)</p>
            <p className="text-sm text-text-muted mb-4">Read → steps below → send allowed commands → store. Each command is saved with its reason, so the dashboard can explain it.</p>
            <ol className="space-y-0">
              {TICK.map((s, i) => (
                <li key={s.id} className="grid grid-cols-[3rem_1fr] gap-3">
                  <div className="flex flex-col items-center">
                    <span className="chip w-full justify-center">{s.id}</span>
                    {i < TICK.length - 1 && <span className="w-px flex-1 bg-line my-1" />}
                  </div>
                  <div className="pb-4">
                    <p className="text-sm font-medium">{s.name} <span className="num text-[11px] text-faint ml-1">{s.file}</span></p>
                    <p className="text-sm text-text-muted">{s.what}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <div className="lg:col-span-5 grid gap-4 content-start">
            {/* ------------------------------------------------ wiring */}
            <section className="panel p-5">
              <p className="eyebrow mb-3">Two-board wiring plan</p>
              <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center text-sm">
                <Box title="DHT11" sub="temp + humidity" />
                <ArrowRight size={14} className="text-faint" />
                <Box title="Arduino Nano" sub="reads every ~2 s, drives LCD" />
                <span />
                <span />
                <div className="text-center text-faint text-xs flex flex-col items-center"><ArrowDown size={14} />UART (5 V → divider → 3.3 V)</div>
                <Box title="Mist pump" sub="motor driver" />
                <ArrowLeft size={14} className="text-faint" />
                <Box title="ESP32" sub="Wi-Fi · failsafe max spray time" />
              </div>
              <p className="text-xs text-faint mt-3">Firmware not written yet. Still to confirm: pump GPIO pin and pump voltage.</p>
            </section>

            {/* ------------------------------------------------ stack */}
            <section className="panel p-5">
              <p className="eyebrow mb-3 flex items-center gap-2"><Database size={13} /> Tech stack</p>
              <dl className="divide-y divide-line text-sm">
                {STACK.map(([k, v]) => (
                  <div key={k} className="flex gap-4 py-2">
                    <dt className="w-24 shrink-0 text-text-muted">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="panel p-5 text-sm text-text-muted">
              See it running on the <Link href="/dashboard" className="text-primary underline underline-offset-2">command centre</Link>,
              or the photo model on the <Link href="/plants" className="text-primary underline underline-offset-2">plant camera</Link>.
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function StatusChip({ status }: { status: Status }) {
  if (status === "real") return <span className="chip chip-real shrink-0">REAL</span>;
  if (status === "sim") return <span className="chip chip-sim shrink-0">SIM</span>;
  return <span className="chip shrink-0" style={{ color: "var(--c-violet)", borderColor: "color-mix(in srgb, var(--c-violet) 45%, transparent)" }}>PLANNED</span>;
}

function Box({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="rounded-xl border border-line bg-card-2 px-3 py-2">
      <p className="font-medium text-sm">{title}</p>
      <p className="text-[11px] text-faint">{sub}</p>
    </div>
  );
}

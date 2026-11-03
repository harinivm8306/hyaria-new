"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import Link from "next/link";
import { useRef } from "react";
import { ArrowRight, Bot, Camera, Cpu, Droplets, FlaskConical, LineChart, Radio, Sprout, SunMedium, Waves } from "lucide-react";
import ChamberView from "@/components/three/ChamberView";
import LiveStrip from "@/components/landing/LiveStrip";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const chapters = [
  {
    n: "01", key: "mist", icon: Waves, tone: "var(--c-mist)",
    title: "Mist pump control",
    body: "Roots hang in air and are misted on a timer that follows the room. Hot, dry air shortens the gap between sprays; cool, humid nights lengthen it.",
    stat: "0.5× – 1.5×", statLabel: "interval range, set by vapour pressure deficit",
  },
  {
    n: "02", key: "nutrient", icon: FlaskConical, tone: "var(--c-leaf)",
    title: "Nutrient and pH balance",
    body: "Small doses of nutrient A and B, a 10-minute wait to mix, then a fresh reading. The controller learns how this tank responds and corrects pH only once nutrients settle.",
    stat: "±0.2", statLabel: "pH dead band around the lettuce target",
  },
  {
    n: "03", key: "light", icon: SunMedium, tone: "var(--c-violet)",
    title: "Grow-light management",
    body: "The LED dims to deliver the day's light target for the crop stage, using daylight first and filling in only what is missing.",
    stat: "14 mol/m²", statLabel: "daily light target, vegetative lettuce",
  },
  {
    n: "04", key: "ai", icon: Sprout, tone: "var(--c-leaf)",
    title: "Plant intelligence",
    body: "Photos are checked for disease, nutrient deficiency and growth stage. Sensor history feeds forecasts so the system acts before a limit is crossed.",
    stat: "Seedling → harvest", statLabel: "growth tracked across the cycle",
  },
];

const models = [
  { icon: Camera, name: "Disease detection", kind: "CNN · EfficientNet-B0", detail: "Names lettuce diseases from a leaf photo: downy and powdery mildew, septoria, bacterial, viral.", status: "Integrating" },
  { icon: FlaskConical, name: "Nutrient deficiency", kind: "CNN · MobileNetV2", detail: "Flags low nitrogen, phosphorus or potassium from leaf colour.", status: "Integrating" },
  { icon: Sprout, name: "Growth stage", kind: "CNN · MobileNetV2", detail: "Early, leafy, head-forming or harvest-ready, from a top-down photo.", status: "Integrating" },
  { icon: LineChart, name: "Forecasting", kind: "Chronos-Bolt", detail: "Predicts temperature, humidity, pH and EC hours ahead.", status: "Integrating" },
  { icon: Cpu, name: "Environment optimiser", kind: "Reinforcement learning · DQN", detail: "Learns misting, airflow and light inside the simulator, always behind the safety layer.", status: "Planned" },
  { icon: Bot, name: "AI advisor", kind: "Local LLM", detail: "Answers questions about your chamber using its live readings. Runs on the laptop.", status: "Running" },
];

const layers = [
  { icon: Radio, name: "Sensing and control", items: ["Arduino Nano reads the DHT11", "ESP32 drives the mist pump", "Simulated pH, EC, light, tank level"] },
  { icon: Cpu, name: "Control engine", items: ["Cleans every reading", "Dosing, misting, lighting loops", "Safety interlocks on every command"] },
  { icon: Droplets, name: "Command centre", items: ["Live readings, labelled real or simulated", "Alerts and manual override", "Every action logged with its reason"] },
];

export default function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const story = useRef({ progress: 0 });

  useGSAP(() => {
    const mm = gsap.matchMedia();

    // hero entrance
    gsap.from(".hero-line", { yPercent: 110, opacity: 0, duration: 1.1, ease: "power4.out", stagger: 0.12, delay: 0.15 });
    gsap.from(".hero-fade", { y: 16, opacity: 0, duration: 0.9, ease: "power3.out", stagger: 0.08, delay: 0.55 });

    // scroll story: one trigger drives the 3D (camera, mist, light, growth)
    ScrollTrigger.create({
      trigger: ".story",
      start: "top top",
      end: "bottom bottom",
      scrub: true,
      onUpdate: (self) => { story.current.progress = self.progress; },
    });

    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.utils.toArray<HTMLElement>(".chapter").forEach((el) => {
        gsap.timeline({ scrollTrigger: { trigger: el, start: "top 75%", end: "bottom 25%", scrub: true } })
          .fromTo(el, { opacity: 0.08, y: 60 }, { opacity: 1, y: 0, ease: "none", duration: 0.35 })
          .to(el, { opacity: 1, duration: 0.3 })
          .to(el, { opacity: 0.08, y: -40, ease: "none", duration: 0.35 });
      });
      gsap.utils.toArray<HTMLElement>(".reveal").forEach((el) => {
        gsap.from(el, { opacity: 0, y: 40, duration: 1, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 85%" } });
      });
      gsap.to(".hero-scrollcue", { y: 8, repeat: -1, yoyo: true, duration: 1.2, ease: "sine.inOut" });
    });
  }, { scope: root });

  return (
    <div ref={root}>
      {/* ------------------------------------------------ scroll story with pinned chamber */}
      <section className="story relative" style={{ height: "520vh" }}>
        <div className="sticky top-0 h-[100svh] overflow-hidden">
          <div className="absolute inset-0 grid-bg opacity-60" />
          <ChamberView story={story} state={{ mistOn: false, ledPwm: 60, growth: 0.72, waterLevel: 78, health: "Good" }} className="absolute inset-0 md:left-[30%]" />
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-r from-bg-dark via-bg-dark/70 to-transparent md:via-bg-dark/40 md:w-[60%]" />
          <div className="absolute inset-x-0 bottom-0 h-40 pointer-events-none bg-gradient-to-t from-bg-dark to-transparent" />
        </div>

        {/* chapter copy scrolls over the pinned scene */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="mx-auto max-w-6xl px-6">
            {/* hero */}
            <div className="h-[100svh] flex flex-col justify-center pt-20 pointer-events-auto max-w-xl">
              <p className="eyebrow hero-fade mb-6 flex items-center gap-2">
                <span className="live-dot text-primary" /> Smart Growth Evolution · SDG 2 Zero Hunger
              </p>
              <h1 className="font-display font-bold leading-[0.95] text-[clamp(2.8rem,7vw,5.6rem)]">
                <span className="block overflow-hidden"><span className="hero-line block">Roots in the air.</span></span>
                <span className="block overflow-hidden"><span className="hero-line block text-gradient">Decisions in software.</span></span>
              </h1>
              <p className="hero-fade mt-7 text-lg text-text-muted max-w-md leading-relaxed">
                HY-ARIA runs an aeroponic chamber for you: it mists the roots, balances nutrients and pH, sets the light,
                and tells you why it did each of those things.
              </p>
              <div className="hero-fade mt-9 flex flex-wrap gap-3">
                <Link href="/dashboard" className="btn btn-primary px-6 py-3 text-sm">Open command centre <ArrowRight size={16} /></Link>
                <Link href="#how" className="btn btn-ghost px-6 py-3 text-sm">See how it works</Link>
              </div>
              <p className="hero-fade hero-scrollcue eyebrow mt-16">Scroll to fly through the chamber ↓</p>
            </div>

            {/* chapters */}
            <div id="how" className="pb-[40vh]">
              {chapters.map((c) => (
                <div key={c.key} className="h-[95svh] flex items-center">
                  <article className="chapter pointer-events-auto glass panel-hi rounded-3xl p-7 sm:p-9 max-w-md">
                    <div className="flex items-center justify-between mb-6">
                      <span className="num text-sm" style={{ color: c.tone }}>{c.n} / 04</span>
                      <c.icon size={20} style={{ color: c.tone }} />
                    </div>
                    <h2 className="font-display text-3xl sm:text-4xl font-bold leading-tight">{c.title}</h2>
                    <p className="mt-4 text-text-muted leading-relaxed">{c.body}</p>
                    <div className="mt-7 pt-6 border-t border-line">
                      <div className="num text-2xl font-semibold" style={{ color: c.tone }}>{c.stat}</div>
                      <div className="text-xs text-text-muted mt-1">{c.statLabel}</div>
                    </div>
                  </article>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ live strip */}
      <section className="relative mx-auto max-w-6xl px-6 -mt-[20vh]">
        <LiveStrip />
      </section>

      {/* ------------------------------------------------ architecture */}
      <section className="mx-auto max-w-6xl px-6 pt-32">
        <div className="reveal max-w-2xl">
          <p className="eyebrow mb-4">System architecture</p>
          <h2 className="font-display text-4xl sm:text-5xl font-bold leading-tight">Three layers, one loop.</h2>
          <p className="mt-5 text-text-muted text-lg leading-relaxed">
            Sensors report every few seconds, the engine decides, the hardware acts, and the result is measured again.
            The engine keeps its own safety limits, so a bad reading or a dropped connection can never flood the roots or overdose the tank.
          </p>
        </div>
        <div className="mt-14 grid md:grid-cols-3 gap-5 relative">
          <div aria-hidden className="hidden md:block absolute top-1/2 left-[8%] right-[8%] h-px bg-gradient-to-r from-primary/0 via-primary/50 to-secondary/0" />
          {layers.map((l, i) => (
            <div key={l.name} className="reveal panel panel-hi p-7 relative">
              <div className="flex items-center justify-between">
                <div className="w-11 h-11 rounded-2xl grid place-items-center bg-card-2 border border-line"><l.icon size={20} className="text-primary" /></div>
                <span className="num text-xs text-faint">Layer {i + 1}</span>
              </div>
              <h3 className="mt-6 font-display text-xl font-bold">{l.name}</h3>
              <ul className="mt-4 space-y-2.5 text-sm text-text-muted">
                {l.items.map((it) => (
                  <li key={it} className="flex gap-2.5"><span className="mt-2 w-1 h-1 rounded-full bg-primary shrink-0" />{it}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ AI models */}
      <section className="mx-auto max-w-6xl px-6 pt-32">
        <div className="reveal flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="eyebrow mb-4">Intelligence</p>
            <h2 className="font-display text-4xl sm:text-5xl font-bold leading-tight">Small models, chosen to run on a laptop.</h2>
          </div>
          <p className="text-text-muted max-w-sm">Each model is lightweight and works offline. Status shows what is running today and what is still being wired in.</p>
        </div>
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {models.map((m) => (
            <div key={m.name} className="reveal group panel p-6 hover:border-line-strong transition-colors">
              <div className="flex items-start justify-between">
                <m.icon size={20} className="text-secondary" />
                <span className={`chip ${m.status === "Running" ? "chip-real" : m.status === "Integrating" ? "chip-sim" : ""}`}>{m.status}</span>
              </div>
              <h3 className="mt-6 font-display text-lg font-bold">{m.name}</h3>
              <p className="num text-[11px] text-faint mt-1">{m.kind}</p>
              <p className="mt-3 text-sm text-text-muted leading-relaxed">{m.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ CTA */}
      <section className="mx-auto max-w-6xl px-6 pt-32">
        <div className="reveal relative overflow-hidden rounded-[2rem] border border-line p-10 sm:p-16">
          <div aria-hidden className="absolute inset-0 grid-bg opacity-70" />
          <div aria-hidden className="absolute -right-20 -top-20 w-96 h-96 rounded-full blur-3xl" style={{ background: "var(--c-glow-violet)" }} />
          <div className="relative max-w-2xl">
            <h2 className="font-display text-4xl sm:text-5xl font-bold leading-tight">See the chamber think.</h2>
            <p className="mt-5 text-text-muted text-lg">Open the command centre to watch live readings, every automatic decision and its reason, and take over by hand whenever you like.</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/dashboard" className="btn btn-primary px-6 py-3 text-sm">Open command centre <ArrowRight size={16} /></Link>
              <Link href="/detector" className="btn btn-ghost px-6 py-3 text-sm">Try the disease lab</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

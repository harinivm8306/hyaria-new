// Demo data for when no HY-ARIA backend is reachable (e.g. the public Vercel site).
// Always shown with a "Demo data" banner; never presented as real readings.

const SENSORS = ["ph", "ec", "water_temp", "air_temp", "humidity", "light_lux", "water_level", "pump_state"] as const;

function wave(t: number, period: number, phase = 0) {
  return Math.sin((t / period) * Math.PI * 2 + phase);
}

function valuesAt(t: number) {
  const hour = new Date(t * 1000).getHours() + new Date(t * 1000).getMinutes() / 60;
  const day = 6 <= hour && hour < 22;
  return {
    ph: 6.02 + 0.09 * wave(t, 5400) + 0.02 * wave(t, 600, 1),
    ec: 1.38 + 0.05 * wave(t, 7200, 2),
    water_temp: 21.0 + 0.8 * wave(t, 86400, -1.2),
    air_temp: 22.5 + 2.5 * wave(t, 86400, -1.6) + 0.15 * wave(t, 900),
    humidity: 64 - 6 * wave(t, 86400, -1.6) + 0.8 * wave(t, 1200, 3),
    light_lux: day ? 9000 + 5000 * Math.max(0, wave(t, 86400, -1.57)) : 40,
    water_level: 82 - ((t / 3600) % 24) * 0.25,
    pump_state: (t % 240) < 5 ? 1 : 0,
  } as Record<(typeof SENSORS)[number], number>;
}

export function demoLive(now = Date.now() / 1000) {
  const v = valuesAt(now);
  const readings: Record<string, any> = {};
  for (const s of SENSORS) readings[s] = { value: Number(v[s].toFixed(3)), raw: v[s], status: "OK", source: "demo", ts: now };
  return {
    device_id: "tower-1",
    time: now,
    demo: true,
    data_source: { name: "demo", can_actuate: false, real_sensors: [] },
    auto: true,
    crop: "lettuce",
    crop_name: "Lettuce",
    day: 18.4,
    stage: { name: "Vegetative", ph: [5.8, 6.2], ec: [1.2, 1.6], air_temp: [18, 24], humidity: [55, 70], water_temp: [18, 22], dli: 14 },
    readings,
    vpd_kpa: 0.98,
    health: { score: 96, band: "Good", reason: "all parameters inside the recipe range" },
    alerts: [],
    controllers: {
      dosing: { k_ec: 0.47, b_down: 1.14, b_up: 1.0, pending: null, mixing_until: null },
      misting: { last_mist_at: now - (now % 240), next_mist_at: now - (now % 240) + 240, why: "base 4 min, VPD 0.98 kPa x0.92" },
      lighting: { dli_so_far: 6.2, dli_target: 14, hours_left: 9.5, pwm: 55 },
    },
    notes: [],
  };
}

export function demoHistory(hours: number, now = Date.now() / 1000) {
  const out: Record<string, { ts: number; value: number }[]> = {};
  const step = Math.max(60, Math.round((hours * 3600) / 240));
  for (const s of SENSORS) out[s] = [];
  for (let t = now - hours * 3600; t <= now; t += step) {
    const v = valuesAt(t);
    for (const s of SENSORS) out[s].push({ ts: t, value: Number(v[s].toFixed(3)) });
  }
  return out;
}

export function demoActions(now = Date.now() / 1000) {
  return [
    { id: 5, ts: now - 60, actuator: "mist", amount: 4, unit: "s", source: "ai", status: "done", reason: "interval 3.7 min (base 4 min, VPD 0.98 kPa x0.92)" },
    { id: 4, ts: now - 900, actuator: "led", amount: 55, unit: "%", source: "ai", status: "done", reason: "need 214 umol/m2/s for 9.5 h to reach DLI 14" },
    { id: 3, ts: now - 2400, actuator: "ph_down", amount: 6.2, unit: "ml", source: "ai", status: "done", reason: "pH 6.31 outside 6.0+/-0.2; b_down=1.14" },
    { id: 2, ts: now - 5400, actuator: "dose_a", amount: 18.5, unit: "ml", source: "ai", status: "done", reason: "EC 1.15 below 1.2-1.6; target 1.40, k=0.47" },
    { id: 1, ts: now - 5400, actuator: "dose_b", amount: 18.5, unit: "ml", source: "ai", status: "done", reason: "EC 1.15 below 1.2-1.6; target 1.40, k=0.47" },
  ];
}

# HY-ARIA — Hardware

## What exists (photo: report Fig 6.2 control board, Fig 6.3 growth chamber)

- **ESP32** and **Arduino Nano** on a perfboard
- **DHT11** temperature + humidity sensor (coarse: about ±2 °C, ±5 % RH, max 1 reading/s → alert limits wider than lettuce targets)
- **Motor driver module**, **pump motors**, mist nozzles, PVC pipes, net pots
- **12 V SMPS** power supply + **buck converter**
- **16×2 LCD**
- 3-tier plastic growth chamber with LED grow light (top: canopy + LED; middle: roots + mist; bottom: reservoir + pump)
- Previous build published readings to **ThingSpeak channel 2899533** (field1 humidity, field2 air temp, field3 water temp, field4 pump state). Keep the read key in `backend/.env`, never in frontend code.

Not available (simulated in software, labelled SIM): pH, EC, ion-selective N/P/K, DS18B20, light, water level (HC-SR04), CO₂, airflow, dosing pumps, fan, heater.

## Wiring plan (agreed with Harini)

```
DHT11 ──► ARDUINO NANO ──UART──► ESP32 ──Wi-Fi──► HY-ARIA backend ──► dashboard
              │                    │  ▲
              ▼                    ▼  └── spray commands (auto + manual)
          16×2 LCD          motor driver → mist pump
```

- **Nano** = sensor node: reads DHT11 every ~2 s, shows values on the LCD, sends `T,H` lines to the ESP32 over serial.
- **ESP32** = gateway + spray controller: Wi-Fi to backend (HTTP POST first, MQTT later), drives the mist pump, **failsafe**: hard max spray time (e.g. 30 s) and stop spraying if the backend has been silent too long.
- Nano TX is 5 V → **voltage divider** (e.g. 1 kΩ / 2 kΩ) before ESP32 RX; ESP32 TX → Nano RX direct; **common GND**.
- Still to confirm: which ESP32 GPIO drives the motor driver, pump voltage (12 V?), whether the motor driver (not a relay) switches the pump.

## Backend integration still to build
- New data source `sources/esp32.py`: `POST /api/ingest` (device id, temp, humidity, pump state) and a command queue the ESP32 polls (or MQTT topics `hyaria/{device}/telemetry`, `/cmd`, `/ack`).
- Real temp/humidity replace simulator env values (same as hybrid mode); spray commands go to the real pump; everything else stays simulated.
- Firmware sketches in `firmware/nano/` and `firmware/esp32/` with wiring diagram and test steps.

## Planned N/P/K hardware (from slides)
Separate N, P, K stock bottles → three **peristaltic pumps** switched by a **relay module** → reservoir; **ion-selective electrodes** (NO₃⁻, K⁺; phosphate ISEs are rare) to measure individual ions. Simulated until bought — design in `docs/ROADMAP.md` §1b.

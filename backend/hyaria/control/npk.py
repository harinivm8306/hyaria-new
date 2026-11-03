"""A16 - N/P/K dosing from ion-selective sensors, cross-checked with the plant camera.

N, P and K are stored in three separate stock bottles, each with its own peristaltic pump
(relay module). Ion-selective electrodes (ISE) read nitrate-N, phosphate-P and K+ in ppm.

Per nutrient:
  ISE low                          -> dose that nutrient (one at a time, most-short first), wait, re-measure, learn gain
  ISE low + camera sees deficiency -> same dose; reason says the camera agrees
  ISE in band + camera deficiency  -> no dose; flag "possible uptake problem" (pH lock-out, cold roots...)
  ISE missing + camera deficiency  -> no dose; ask for a manual check (never dose on the camera alone)
  ISE high                         -> no dose; EC dilution (A2) brings it down
The base A/B mix (A2) still holds total EC; this loop fixes the balance between ions.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

from ..models import Command
from ..recipes import band_mid

NUTRIENTS = ("n", "p", "k")
SENSOR = {"n": "n_ppm", "p": "p_ppm", "k": "k_ppm"}
ACTUATOR = {"n": "dose_n", "p": "dose_p", "k": "dose_k"}
NAME = {"n": "Nitrogen (NO3-N)", "p": "Phosphorus (P)", "k": "Potassium (K)"}

LAMBDA = 0.7                 # under-dose, approach from below
ETA = 0.2                    # gain learning rate
MIX_WAIT_S = 15 * 60
MAX_NPK_ML = 30.0            # per dose
MAX_DOSES_PER_HOUR = 2
GAIN_INIT = 5.0              # guess: ppm rise per ml per litre; learned per bottle
VISION_MIN_CONF = 0.6
VISION_STREAK = 2            # photos in a row that must agree before the camera counts


@dataclass
class NpkState:
    gain_n: float = GAIN_INIT
    gain_p: float = GAIN_INIT
    gain_k: float = GAIN_INIT
    pending: str | None = None       # "n" | "p" | "k"
    pending_amount: float = 0.0
    pending_before: float = 0.0
    pending_volume_l: float = 0.0
    wait_until: float = 0.0
    dose_times: list = None
    vision_label: str | None = None  # last confident camera label
    vision_streak: int = 0
    vision_conf: float = 0.0
    vision_ts: float | None = None
    response_issue: str | None = None

    def __post_init__(self):
        if self.dose_times is None:
            self.dose_times = []

    def gain(self, n: str) -> float:
        return getattr(self, f"gain_{n}")

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "NpkState":
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})

    def mixing(self, now: float) -> bool:
        return self.pending is not None and now < self.wait_until

    def note_vision(self, npk: dict, ts: float) -> None:
        """Feed one camera result (vision.analyse()['npk']). Low-confidence photos are ignored."""
        if not npk.get("available") or npk.get("low_confidence"):
            return
        label = npk["label"]
        self.vision_streak = self.vision_streak + 1 if label == self.vision_label else 1
        self.vision_label, self.vision_conf, self.vision_ts = label, float(npk["confidence"]), ts

    def camera_says(self, nutrient: str) -> bool:
        return (self.vision_label == f"{nutrient}_deficient" and self.vision_streak >= VISION_STREAK
                and self.vision_conf >= VISION_MIN_CONF)


def npk_step(state: NpkState, now: float, ions: dict, volume_l: float, stage: dict,
             ph_in_band: bool) -> tuple[list[Command], dict, list[dict]]:
    """ions: nutrient -> ppm or None (missing/faulty probe).
    Returns (commands, per-nutrient status for the UI, issues for alerts)."""
    cmds: list[Command] = []
    status: dict = {}
    issues: list[dict] = []
    bands = stage.get("npk")
    if not bands:
        return cmds, {}, []
    state.dose_times = [t for t in state.dose_times if now - t < 3600]

    # 1. learn from the last dose once it has mixed
    if state.pending and now >= state.wait_until:
        n = state.pending
        v = ions.get(n)
        if v is not None:
            observed = (v - state.pending_before) * max(state.pending_volume_l, 1.0) / state.pending_amount
            old = state.gain(n)
            if observed < 0.2 * old:
                state.response_issue = (f"{NAME[n]} dose changed the reading by only {max(observed, 0) / old:.0%} "
                                        f"of the expected amount: check the {n.upper()} bottle, pump and ion sensor")
            else:
                state.response_issue = None
                setattr(state, f"gain_{n}", max(0.5, min(old + ETA * (observed - old), 50.0)))
        state.pending = None

    short: list[tuple[float, str]] = []
    for n in NUTRIENTS:
        lo, hi = bands[n]
        v = ions.get(n)
        cam = state.camera_says(n)
        st = {"value": v, "band": [lo, hi], "camera_deficient": cam, "gain": round(state.gain(n), 2)}
        if v is None:
            st.update(state="unknown", why="ion sensor not reading")
            if cam:
                issues.append({"key": f"npk:check_{n}", "severity": "warning",
                               "message": f"Camera sees {NAME[n]} deficiency but the {n.upper()} ion sensor is not "
                                          f"reading: test the solution by hand before dosing"})
        elif v < lo:
            st.update(state="low", why=f"{v:.0f} ppm below {lo}-{hi}" + ("; camera agrees" if cam else ""))
            short.append(((lo - v) / lo, n))
        elif v > hi:
            st.update(state="high", why=f"{v:.0f} ppm above {lo}-{hi}; EC dilution will bring it down")
        else:
            st.update(state="ok", why=f"{v:.0f} ppm in {lo}-{hi}")
            if cam:
                st["why"] += "; camera sees deficiency anyway"
                issues.append({"key": f"npk:uptake_{n}", "severity": "warning",
                               "message": f"Camera sees {NAME[n]} deficiency but the solution has enough "
                                          f"({v:.0f} ppm): possible uptake problem, check pH, root temperature "
                                          f"and roots; not dosing more"})
        status[n] = st

    if state.response_issue:
        issues.append({"key": "npk:no_response", "severity": "warning", "message": state.response_issue})
    if state.mixing(now):
        status["note"] = f"mixing after {state.pending.upper()} dose, re-measure in {int(state.wait_until - now)} s"
        return cmds, status, issues
    if not short:
        return cmds, status, issues
    if not ph_in_band:
        status["note"] = "N/P/K dosing waits until pH is back in range (uptake depends on pH)"
        return cmds, status, issues
    if len(state.dose_times) >= MAX_DOSES_PER_HOUR:
        status["note"] = "N/P/K dose limit reached for this hour"
        return cmds, status, issues

    # 2. dose the nutrient that is furthest below its band (relative), one at a time
    _, n = max(short)
    v = ions[n]
    target = band_mid(bands[n])
    ml = round(min(max(LAMBDA * (target - v) * volume_l / state.gain(n), 0.5), MAX_NPK_ML), 1)
    reason = (f"{NAME[n]} {v:.0f} ppm below {bands[n][0]}-{bands[n][1]}; target {target:.0f}, "
              f"gain {state.gain(n):.1f} ppm per ml/L" + ("; camera also sees this deficiency" if state.camera_says(n) else ""))
    cmds.append(Command(ACTUATOR[n], ml, reason))
    state.pending, state.pending_amount, state.pending_before = n, ml, v
    state.pending_volume_l, state.wait_until = volume_l, now + MIX_WAIT_S
    state.dose_times.append(now)
    status["note"] = f"dosing {ml} ml {n.upper()}"
    return cmds, status, issues

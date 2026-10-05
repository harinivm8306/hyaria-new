"""A2 - nutrient (EC) and pH dosing as a feedback loop with learned tank gains.

EC first: dose equal ml of stock A and B, under-dosing by LAMBDA so we approach from
below, wait MIX_WAIT_S, re-measure, learn k (EC rise per ml each per litre).
EC too high: dilute with fresh water. pH only when EC is settled, with a deadband.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

from ..models import Command
from ..recipes import band_mid

LAMBDA = 0.7
ETA = 0.2
MIX_WAIT_S = 10 * 60
MAX_DOSE_ML = 60.0          # per pump per cycle
MAX_PH_ML = 20.0
MAX_CYCLES_PER_HOUR = 3
PH_DEADBAND = 0.2
K_INIT = 0.5                # guess; learned per tank
B_DOWN_INIT = 1.0
B_UP_INIT = 1.0


@dataclass
class DosingState:
    k_ec: float = K_INIT
    b_down: float = B_DOWN_INIT
    b_up: float = B_UP_INIT
    pending: str | None = None        # "ec" | "ph_down" | "ph_up" | "dilute"
    pending_amount: float = 0.0
    pending_before: float = 0.0
    pending_volume_l: float = 0.0
    wait_until: float = 0.0
    cycle_times: list = None
    response_issue: str | None = None

    def __post_init__(self):
        if self.cycle_times is None:
            self.cycle_times = []

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "DosingState":
        fields = {k: v for k, v in d.items() if k in cls.__dataclass_fields__}
        return cls(**fields)


def _learn(state: "DosingState", name: str, old: float, observed: float) -> float:
    """Update a tank gain; flag a dose that barely moved the reading."""
    if observed < 0.2 * old:
        state.response_issue = (f"{name} dose changed the reading by only {max(observed, 0) / old:.0%} of the "
                                f"expected amount: check the stock bottle, dosing pump and probe calibration")
        return old
    state.response_issue = None
    new = old + ETA * (observed - old)
    return max(0.05, min(new, 10.0))


def dosing_step(state: DosingState, now: float, ec: float | None, ph: float | None,
                volume_l: float, capacity_l: float, stage: dict,
                ec_ok: bool = True, ph_ok: bool = True) -> tuple[list[Command], list[str]]:
    """Return commands to send now and human-readable notes."""
    notes: list[str] = []
    cmds: list[Command] = []
    state.cycle_times = [t for t in state.cycle_times if now - t < 3600]

    # 1. Still mixing? Learn from the previous dose once the wait is over.
    if state.pending:
        if now < state.wait_until:
            return cmds, [f"mixing after {state.pending} dose, re-measure in {int(state.wait_until - now)} s"]
        vol = max(state.pending_volume_l, 1.0)
        if state.pending == "ec" and ec is not None and ec_ok:
            observed = (ec - state.pending_before) * vol / state.pending_amount
            state.k_ec = _learn(state, "Nutrient", state.k_ec, observed)
            notes.append(f"learned k_ec={state.k_ec:.3f}")
        elif state.pending == "ph_down" and ph is not None and ph_ok:
            observed = (state.pending_before - ph) * vol / state.pending_amount
            state.b_down = _learn(state, "pH-down", state.b_down, observed)
            notes.append(f"learned b_down={state.b_down:.3f}")
        elif state.pending == "ph_up" and ph is not None and ph_ok:
            observed = (ph - state.pending_before) * vol / state.pending_amount
            state.b_up = _learn(state, "pH-up", state.b_up, observed)
            notes.append(f"learned b_up={state.b_up:.3f}")
        state.pending = None

    if len(state.cycle_times) >= MAX_CYCLES_PER_HOUR:
        return cmds, notes + ["dose limit reached for this hour"]

    ec_lo, ec_hi = stage["ec"]
    ec_target = band_mid(stage["ec"])
    # 2. EC correction
    if ec is not None and ec_ok:
        if ec < ec_lo:
            ml = LAMBDA * (ec_target - ec) * volume_l / state.k_ec
            ml = round(min(max(ml, 1.0), MAX_DOSE_ML), 1)
            reason = f"EC {ec:.2f} below {ec_lo}-{ec_hi}; target {ec_target:.2f}, k={state.k_ec:.2f}"
            cmds += [Command("dose_a", ml, reason), Command("dose_b", ml, reason)]
            state.pending, state.pending_amount, state.pending_before = "ec", ml, ec
            state.pending_volume_l, state.wait_until = volume_l, now + MIX_WAIT_S
            state.cycle_times.append(now)
            return cmds, notes
        if ec > ec_hi:
            free = capacity_l - volume_l
            want = volume_l * (ec / ec_target - 1.0)
            litres = round(min(want, free), 1)
            if litres >= 0.5:
                cmds.append(Command("water_add", litres, f"EC {ec:.2f} above {ec_hi}; diluting toward {ec_target:.2f}"))
                state.pending, state.pending_amount, state.pending_before = "dilute", litres, ec
                state.pending_volume_l, state.wait_until = volume_l, now + MIX_WAIT_S
                state.cycle_times.append(now)
                return cmds, notes
            notes.append("EC high but tank is full: drain some solution manually")

    # 3. pH correction only when EC is settled
    if ph is not None and ph_ok:
        target = band_mid(stage["ph"])
        if abs(ph - target) > PH_DEADBAND:
            if ph > target:
                ml = LAMBDA * (ph - target) * volume_l / state.b_down
                act, gain = "ph_down", "b_down"
            else:
                ml = LAMBDA * (target - ph) * volume_l / state.b_up
                act, gain = "ph_up", "b_up"
            ml = round(min(max(ml, 0.5), MAX_PH_ML), 1)
            cmds.append(Command(act, ml, f"pH {ph:.2f} outside {target:.1f}+/-{PH_DEADBAND}; {gain}={getattr(state, gain):.2f}"))
            state.pending, state.pending_amount, state.pending_before = act, ml, ph
            state.pending_volume_l, state.wait_until = volume_l, now + MIX_WAIT_S
            state.cycle_times.append(now)
    return cmds, notes

from __future__ import annotations

from ..models import Ack, Command, Reading


class DataSource:
    """A place readings come from and commands go to."""

    name = "base"
    can_actuate = False

    def step(self, now: float, dt: float) -> None:  # advance any simulated state
        pass

    def read(self, now: float) -> dict[str, Reading]:
        raise NotImplementedError

    def apply(self, cmd: Command, now: float) -> Ack:
        return Ack(False, "this data source cannot drive actuators")

    def info(self) -> dict:
        return {"name": self.name, "can_actuate": self.can_actuate}

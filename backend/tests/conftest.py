import os
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("HYARIA_START_ENGINE", "0")

from hyaria import db  # noqa: E402
from hyaria.config import Settings  # noqa: E402


@pytest.fixture()
def fresh_db(tmp_path):
    db.reset_engine(f"sqlite:///{tmp_path / 'test.db'}")
    yield
    db.reset_engine(f"sqlite:///{tmp_path / 'unused.db'}")


@pytest.fixture()
def sim_settings(fresh_db):
    s = Settings()
    s.data_source = "simulator"
    s.device_id = "tower-test"
    s.crop = "lettuce"
    s.planted_days_ago = 12
    s.store_every_seconds = 300
    s.start_engine = False
    return s


class FakeClock:
    def __init__(self, start=1_760_000_000.0):  # fixed epoch for repeatable runs
        self.t = start

    def __call__(self):
        return self.t

    def advance(self, seconds):
        self.t += seconds


@pytest.fixture()
def clock():
    return FakeClock()

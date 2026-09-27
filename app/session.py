"""Training session accounting (spec §5).

tick() is called at 1 Hz. A second counts toward duration and zones only when
the session is not paused and heart rate is fresh (signal gaps longer than
HR_LOSS_GRACE_S are excluded). Seconds below Z1 are tracked as out_zone_s.
"""
import time

from . import zones


class Session:
    def __init__(self, profile: dict, source: str | None, started_at: float | None = None):
        self.profile = profile
        self.source = source
        self.floors = zones.floors_for(profile)
        self.started_at = started_at or time.time()
        self.db_id: int | None = None
        self.duration_s = 0
        self.zone_s = [0, 0, 0, 0, 0]
        self.out_zone_s = 0
        self.paused = False
        self.finished = False
        self.peak = 0
        self._hr_sum = 0
        self._hr_n = 0
        self._t_sum = 0.0
        self._t_n = 0
        self._h_sum = 0.0
        self._h_n = 0
        self.pending: list[dict] = []    # samples not yet written to SQLite

    def tick(self, now: float, hr: int | None, rr: list[int], temp, hum, connected: bool):
        if self.finished:
            return
        counted = not self.paused and hr is not None
        zone = zones.zone_of(hr, self.floors) if hr is not None else None
        if counted:
            self.duration_s += 1
            self._hr_sum += hr
            self._hr_n += 1
            self.peak = max(self.peak, hr)
            if zone:
                self.zone_s[zone - 1] += 1
            else:
                self.out_zone_s += 1
            if temp is not None:
                self._t_sum += temp
                self._t_n += 1
            if hum is not None:
                self._h_sum += hum
                self._h_n += 1
        if not self.paused:
            self.pending.append({"t": now, "hr": hr, "rr": rr, "zone": zone, "temp": temp, "hum": hum,
                                 "connected": connected, "counted": counted})

    def take_pending(self) -> list[dict]:
        out, self.pending = self.pending, []
        return out

    def summary(self) -> dict:
        return {
            "profile_id": self.profile.get("id"),
            "started_at": self.started_at,
            "duration_s": self.duration_s,
            "zone_s": list(self.zone_s),
            "out_zone_s": self.out_zone_s,
            "avg_hr": round(self._hr_sum / self._hr_n) if self._hr_n else None,
            "peak_hr": self.peak or None,
            "avg_temp": round(self._t_sum / self._t_n, 1) if self._t_n else None,
            "avg_hum": round(self._h_sum / self._h_n, 1) if self._h_n else None,
            "source": self.source,
        }

    def snapshot(self) -> dict:
        return {**self.summary(), "id": self.db_id, "paused": self.paused, "finished": self.finished}

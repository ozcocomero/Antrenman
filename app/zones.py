"""Heart rate zones (spec §4).

Bounds are fractions of max HR: 50/60/70/80/90/100 %. Lower bound inclusive,
upper exclusive, Z5 includes its upper bound. Below Z1 is "out of zone" (0).
"""
import math

NAMES = ["Isınma", "Kolay", "Aerobik", "Eşik", "Maksimum"]
COLORS = ["#A8B0BA", "#5AA0E0", "#4CC07F", "#F59A3C", "#F0605A"]
BOUNDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0]


def rnd(x: float) -> int:
    """Half-up rounding, same as JavaScript Math.round (Python's round() is half-to-even)."""
    return math.floor(x + 0.5 + 1e-9)


def tanaka_max(age: int) -> int:
    return rnd(208 - 0.7 * age)


def floors_for(profile: dict) -> list[int]:
    """Returns 6 values: Z1..Z5 lower bounds followed by max HR."""
    source = profile.get("zone_source") or "age"
    gz = garmin_zone(profile)
    if source == "garmin" and gz:
        return [int(f) for f in gz["floors"][:5]] + [int(gz["max_hr"])]
    if source == "manual":
        mx = int(profile.get("max_hr") or tanaka_max(int(profile.get("age") or 35)))
        rest = int(profile.get("rest_hr") or 60)
        if profile.get("zone_method") == "hrr":   # Karvonen / heart rate reserve
            return [rnd(rest + (mx - rest) * b) for b in BOUNDS]
        return [rnd(mx * b) for b in BOUNDS]
    mx = tanaka_max(int(profile.get("age") or 35))
    return [rnd(mx * b) for b in BOUNDS]


def garmin_zone(profile: dict) -> dict | None:
    zs = profile.get("garmin_zones") or {}
    return zs.get(profile.get("garmin_sport") or "DEFAULT") or zs.get("DEFAULT") or next(iter(zs.values()), None)


def zone_of(hr: int, floors: list[int]) -> int:
    if hr < floors[0]:
        return 0
    for z in range(5, 0, -1):
        if hr >= floors[z - 1]:
            return z
    return 0


def describe(profile: dict) -> dict:
    floors = floors_for(profile)
    return {
        "floors": floors,
        "max": floors[5],
        "zones": [{"n": i + 1, "name": NAMES[i], "color": COLORS[i], "lo": floors[i], "hi": floors[i + 1],
                   "pct": f"%{round(BOUNDS[i] * 100)}–{round(BOUNDS[i + 1] * 100)}"} for i in range(5)],
    }

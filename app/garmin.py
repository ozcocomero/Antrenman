"""Garmin Connect heart rate zones (optional, unofficial API via `garminconnect`).

One-time login per profile, over SSH on the Pi (password is never stored):

    .venv/bin/python -m app.garmin --profile 1

Tokens live in ~/.config/pt-ekran/garmin/<profile_id>/ (0700 dir, 0600 files).
On failure the last cached zones stay in use (CLAUDE.md).
"""
import argparse
import getpass
import logging
import os
import time

from . import config, db

log = logging.getLogger("pt.garmin")

ZONES_PATH = "/biometric-service/heartRateZones"


def token_dir(pid: int):
    return config.GARMIN_DIR / str(int(pid))


def has_login(pid: int) -> bool:
    d = token_dir(pid)
    return d.is_dir() and any(d.iterdir())


def _lock_down(d):
    os.chmod(d, 0o700)
    for f in d.iterdir():
        os.chmod(f, 0o600)


def parse_zones(payload) -> dict:
    """{sport: {"floors": [5], "max_hr", "rest_hr", "method"}} from the Garmin response."""
    items = payload if isinstance(payload, list) else [payload]
    out = {}
    for z in items:
        if not isinstance(z, dict):
            continue
        floors = [z.get(f"zone{n}Floor") for n in range(1, 6)]
        if not all(isinstance(f, (int, float)) for f in floors):
            continue
        sport = z.get("sport") or "DEFAULT"
        out[sport] = {
            "floors": [int(f) for f in floors],
            "max_hr": int(z.get("maxHeartRateUsed") or floors[-1] + 15),
            "rest_hr": int(z["restingHeartRateUsed"]) if z.get("restingHeartRateUsed") else None,
            "method": z.get("trainingMethod"),
        }
    return out


def fetch(pid: int) -> dict:
    from garminconnect import Garmin
    if not has_login(pid):
        raise RuntimeError("Bu profil için Garmin girişi yapılmamış")
    api = Garmin()
    api.login(tokenstore=str(token_dir(pid)))
    getter = getattr(api, "get_heart_rate_zones", None)
    payload = getter() if getter else api.connectapi(ZONES_PATH)
    zones = parse_zones(payload)
    if not zones:
        raise RuntimeError("Garmin zone bilgisi okunamadı")
    return zones


def sync(pid: int) -> dict:
    zones = fetch(pid)
    return db.update_profile(pid, {"garmin_zones": zones, "garmin_synced_at": time.time()})


def main():
    ap = argparse.ArgumentParser(description="Garmin Connect login for one profile")
    ap.add_argument("--profile", type=int, required=True, help="profile id")
    args = ap.parse_args()
    config.ensure_dirs()
    p = db.get_profile(args.profile)
    if not p:
        print("Profil bulunamadı. Mevcut profiller:")
        for x in db.list_profiles():
            print(f"  {x['id']}: {x['name']}")
        return
    from garminconnect import Garmin
    d = token_dir(args.profile)
    d.mkdir(parents=True, exist_ok=True, mode=0o700)
    api = Garmin(email=input("Garmin e-posta: "), password=getpass.getpass("Şifre: "),
                 prompt_mfa=lambda: input("MFA kodu: "))
    api.login(tokenstore=str(d))
    try:
        api.client.dump(str(d))
    except Exception:
        pass
    _lock_down(d)
    p = sync(args.profile)
    db.update_profile(args.profile, {"zone_source": "garmin"})
    print(f"{p['name']}: Garmin zone'ları kaydedildi ({', '.join(p['garmin_zones'])}).")


if __name__ == "__main__":
    main()

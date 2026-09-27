"""SQLite storage with versioned migrations (PRAGMA user_version)."""
import json
import sqlite3
import threading
import time

from . import config

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None

MIGRATIONS = [
    # v1
    """
    CREATE TABLE profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        age INTEGER NOT NULL DEFAULT 35,
        height_cm INTEGER,
        weight_kg INTEGER,
        has_photo INTEGER NOT NULL DEFAULT 0,
        photo_version INTEGER NOT NULL DEFAULT 0,
        zone_source TEXT NOT NULL DEFAULT 'age',
        zone_method TEXT NOT NULL DEFAULT 'max',
        max_hr INTEGER,
        rest_hr INTEGER,
        garmin_sport TEXT NOT NULL DEFAULT 'DEFAULT',
        garmin_zones TEXT,
        garmin_synced_at REAL,
        last_device TEXT,
        consent_at REAL,
        created_at REAL NOT NULL,
        last_used_at REAL
    );
    CREATE TABLE sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'active',
        started_at REAL NOT NULL,
        ended_at REAL,
        duration_s INTEGER NOT NULL DEFAULT 0,
        out_zone_s INTEGER NOT NULL DEFAULT 0,
        zone_s TEXT NOT NULL DEFAULT '[0,0,0,0,0]',
        avg_hr INTEGER,
        peak_hr INTEGER,
        avg_temp REAL,
        avg_hum REAL,
        source TEXT
    );
    CREATE INDEX sessions_profile ON sessions(profile_id, started_at);
    CREATE TABLE samples (
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        t REAL NOT NULL,
        hr INTEGER,
        rr TEXT,
        zone INTEGER,
        temp REAL,
        hum REAL,
        connected INTEGER NOT NULL,
        counted INTEGER NOT NULL
    );
    CREATE INDEX samples_session ON samples(session_id, t);
    """,
]


def _migrate(c: sqlite3.Connection):
    version = c.execute("PRAGMA user_version").fetchone()[0]
    for i, sql in enumerate(MIGRATIONS[version:], start=version + 1):
        c.executescript("BEGIN;" + sql + f"; PRAGMA user_version={i}; COMMIT;")


def open_db(path=None) -> sqlite3.Connection:
    global _conn
    if path is None:
        config.ensure_dirs()
        path = config.DB_PATH
    c = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")     # survives power loss better, fewer fsyncs
    c.execute("PRAGMA synchronous=NORMAL")
    c.execute("PRAGMA foreign_keys=ON")
    _migrate(c)
    _conn = c
    return c


def conn() -> sqlite3.Connection:
    return _conn or open_db()


def _tx(fn):
    with _lock:
        c = conn()
        c.execute("BEGIN")
        try:
            out = fn(c)
            c.execute("COMMIT")
            return out
        except Exception:
            c.execute("ROLLBACK")
            raise


# ---------- profiles ----------
EDITABLE = ("name", "age", "height_cm", "weight_kg", "zone_source", "zone_method", "max_hr", "rest_hr",
            "garmin_sport", "garmin_zones", "garmin_synced_at", "last_device", "consent_at",
            "has_photo", "photo_version", "last_used_at")
JSON_FIELDS = ("garmin_zones", "last_device")


def _profile(row) -> dict | None:
    if row is None:
        return None
    p = dict(row)
    for k in JSON_FIELDS:
        p[k] = json.loads(p[k]) if p[k] else None
    return p


def list_profiles() -> list[dict]:
    with _lock:
        rows = conn().execute(
            "SELECT * FROM profiles ORDER BY last_used_at IS NULL, last_used_at DESC, id").fetchall()
    return [_profile(r) for r in rows]


def get_profile(pid: int) -> dict | None:
    with _lock:
        return _profile(conn().execute("SELECT * FROM profiles WHERE id=?", (pid,)).fetchone())


def create_profile(data: dict) -> dict:
    vals = {k: data[k] for k in EDITABLE if k in data}
    vals["created_at"] = time.time()
    for k in JSON_FIELDS:
        if k in vals and vals[k] is not None:
            vals[k] = json.dumps(vals[k])
    pid = _tx(lambda c: c.execute(
        f"INSERT INTO profiles ({', '.join(vals)}) VALUES ({', '.join('?' * len(vals))})",
        tuple(vals.values())).lastrowid)
    return get_profile(pid)


def update_profile(pid: int, data: dict) -> dict:
    vals = {k: data[k] for k in EDITABLE if k in data}
    for k in JSON_FIELDS:
        if k in vals and vals[k] is not None:
            vals[k] = json.dumps(vals[k])
    if vals:
        _tx(lambda c: c.execute(f"UPDATE profiles SET {', '.join(f'{k}=?' for k in vals)} WHERE id=?",
                                (*vals.values(), pid)))
    return get_profile(pid)


def delete_profile(pid: int):
    # sessions and samples go with it (ON DELETE CASCADE); the photo file is removed by the caller
    _tx(lambda c: c.execute("DELETE FROM profiles WHERE id=?", (pid,)))


# ---------- sessions ----------
def _session(row):
    if row is None:
        return None
    d = dict(row)
    d["zone_s"] = json.loads(d["zone_s"])
    return d


def start_session(profile_id: int, started_at: float, source: str | None) -> int:
    return _tx(lambda c: c.execute(
        "INSERT INTO sessions (profile_id, started_at, source) VALUES (?,?,?)",
        (profile_id, started_at, source)).lastrowid)


def write_samples(session_id: int, samples: list[dict], summary: dict):
    """One transaction per flush: samples plus the running summary (power-loss safe)."""
    def fn(c):
        c.executemany(
            "INSERT INTO samples (session_id, t, hr, rr, zone, temp, hum, connected, counted)"
            " VALUES (?,?,?,?,?,?,?,?,?)",
            [(session_id, s["t"], s["hr"], json.dumps(s["rr"]) if s["rr"] else None, s["zone"],
              s["temp"], s["hum"], int(s["connected"]), int(s["counted"])) for s in samples])
        _update_summary(c, session_id, summary)
    _tx(fn)


def _update_summary(c, session_id, s):
    c.execute("UPDATE sessions SET duration_s=?, out_zone_s=?, zone_s=?, avg_hr=?, peak_hr=?, avg_temp=?,"
              " avg_hum=? WHERE id=?",
              (s["duration_s"], s["out_zone_s"], json.dumps(s["zone_s"]), s["avg_hr"], s["peak_hr"],
               s["avg_temp"], s["avg_hum"], session_id))


def finish_session(session_id: int, status: str, summary: dict):
    def fn(c):
        _update_summary(c, session_id, summary)
        c.execute("UPDATE sessions SET status=?, ended_at=? WHERE id=?", (status, time.time(), session_id))
    _tx(fn)


def delete_session(session_id: int):
    _tx(lambda c: c.execute("DELETE FROM sessions WHERE id=?", (session_id,)))


def mark_interrupted():
    """Sessions left 'active' by a crash or power cut are kept as 'interrupted'."""
    _tx(lambda c: c.execute(
        "UPDATE sessions SET status='interrupted', ended_at=COALESCE(ended_at, started_at + duration_s)"
        " WHERE status='active'"))


def list_sessions(pid: int, limit: int = 100) -> list[dict]:
    with _lock:
        rows = conn().execute(
            "SELECT * FROM sessions WHERE profile_id=? AND status!='active' AND duration_s>0"
            " ORDER BY started_at DESC LIMIT ?", (pid, limit)).fetchall()
    return [_session(r) for r in rows]


def get_session(sid: int) -> dict | None:
    with _lock:
        return _session(conn().execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone())


def count_samples(sid: int) -> int:
    with _lock:
        return conn().execute("SELECT COUNT(*) FROM samples WHERE session_id=?", (sid,)).fetchone()[0]

from app.session import Session

P = {"id": 1, "zone_source": "manual", "zone_method": "max", "max_hr": 200}   # floors 100/120/140/160/180/200


def run(s, hrs, t0=1000.0):
    for i, hr in enumerate(hrs):
        s.tick(t0 + i, hr, [], 24.0, 50.0, hr is not None)


def test_zone_time_and_averages():
    s = Session(P, "Strap")
    run(s, [110, 110, 130, 190, 90])
    assert s.duration_s == 5
    assert s.zone_s == [2, 1, 0, 0, 1]
    assert s.out_zone_s == 1                  # 90 bpm: below Z1, not written to Z1
    sm = s.summary()
    assert sm["avg_hr"] == round((110 + 110 + 130 + 190 + 90) / 5)
    assert sm["peak_hr"] == 190
    assert sm["avg_temp"] == 24.0


def test_signal_loss_is_not_counted():
    s = Session(P, None)
    run(s, [110, None, None, None, None, 130])
    assert s.duration_s == 2
    assert sum(s.zone_s) == 2
    assert s.summary()["avg_hr"] == 120


def test_pause_stops_time_and_zones_and_samples():
    s = Session(P, None)
    run(s, [110, 110])
    s.paused = True
    run(s, [150, 150, 150])
    s.paused = False
    run(s, [150])
    assert s.duration_s == 3
    assert s.zone_s == [2, 0, 1, 0, 0]
    assert len(s.take_pending()) == 3         # nothing sampled while paused


def test_samples_keep_rr_and_uncounted_seconds():
    s = Session(P, None)
    s.tick(1.0, 120, [500, 498], None, None, True)
    s.tick(2.0, None, [], None, None, False)
    a, b = s.take_pending()
    assert a["rr"] == [500, 498] and a["counted"] and a["zone"] == 2
    assert not b["counted"] and not b["connected"]
    assert s.take_pending() == []


def test_finished_session_ignores_ticks():
    s = Session(P, None)
    s.finished = True
    run(s, [150])
    assert s.duration_s == 0

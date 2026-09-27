from app import zones


def test_tanaka():
    assert zones.tanaka_max(45) == 177   # 176.5 rounds half up, like the UI (Math.round)
    assert zones.tanaka_max(30) == 187


def test_age_floors_are_percent_of_max():
    f = zones.floors_for({"zone_source": "age", "age": 30})
    assert f == [94, 112, 131, 150, 168, 187]


def test_matches_design_example():
    # design/Settings.dc.html: age 45 -> 89–106 … 159–177
    assert zones.floors_for({"zone_source": "age", "age": 45}) == [89, 106, 124, 142, 159, 177]


def test_boundaries_lower_inclusive_upper_exclusive():
    f = [100, 120, 140, 160, 180, 200]
    assert zones.zone_of(99, f) == 0          # below 50 % is out of zone
    assert zones.zone_of(100, f) == 1
    assert zones.zone_of(119, f) == 1
    assert zones.zone_of(120, f) == 2
    assert zones.zone_of(179, f) == 4
    assert zones.zone_of(180, f) == 5
    assert zones.zone_of(200, f) == 5         # Z5 includes its upper bound
    assert zones.zone_of(215, f) == 5


def test_manual_percent_max_and_hrr():
    base = {"zone_source": "manual", "max_hr": 200, "rest_hr": 60}
    assert zones.floors_for({**base, "zone_method": "max"})[:2] == [100, 120]
    hrr = zones.floors_for({**base, "zone_method": "hrr"})
    assert hrr[0] == 60 + 70                  # rest + 50 % of reserve
    assert hrr[5] == 200


def test_garmin_uses_selected_sport_and_falls_back():
    gz = {"DEFAULT": {"floors": [95, 114, 133, 152, 171], "max_hr": 190},
          "RUNNING": {"floors": [100, 120, 140, 160, 175], "max_hr": 188}}
    p = {"zone_source": "garmin", "garmin_zones": gz, "garmin_sport": "RUNNING", "age": 40}
    assert zones.floors_for(p) == [100, 120, 140, 160, 175, 188]
    assert zones.floors_for({**p, "garmin_sport": "CYCLING"})[0] == 95
    # no cached Garmin zones yet -> age based
    assert zones.floors_for({**p, "garmin_zones": None}) == zones.floors_for({"zone_source": "age", "age": 40})

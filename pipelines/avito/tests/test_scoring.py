from score_laptops import CPUScorer, calc_laptop_score


def test_exact_cpu_model_is_scored():
    assert CPUScorer.get_score("i5-8250u") > 0


def test_generation_only_cpu_scores_like_its_generation():
    # Sellers often write "i5 8eme" with no model number
    exact = CPUScorer.get_score("i5-8250u")
    generation = CPUScorer.get_score("i5 8th gen")

    assert generation > 0
    assert 0.5 * exact <= generation <= 2 * exact


def test_newer_generation_scores_higher():
    assert CPUScorer.get_score("i5 12th gen") > CPUScorer.get_score("i5 6th gen")
    assert CPUScorer.get_score("i7 8th gen") > CPUScorer.get_score("i3 8th gen")
    assert CPUScorer.get_score("Ryzen 5 5th gen") > CPUScorer.get_score("Ryzen 5 3rd gen") > 0


def test_generation_match_uses_laptop_parts_only():
    names = [name for name, _ in CPUScorer._generation_matches("i5 13th gen")]

    assert names and all("13" in name for name in names)
    assert not any(name.endswith(("k", "kf", "t", "f")) or name.endswith("13600") for name in names)


def test_unknown_cpu_scores_zero_but_laptop_still_gets_a_score():
    assert CPUScorer.get_score("Snapdragon Mystery 9000") == 0
    assert calc_laptop_score({"cpu": None, "ram": 16, "storage": 512, "ssd": 1}) > 0

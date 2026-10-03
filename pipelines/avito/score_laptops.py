import csv
import math
import os
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple


# =========================================================================
# CPU SCORING
# =========================================================================


class CPUScorer:
    _cpu_db: Dict[str, int] = {}
    _max_score: int = 1
    _loaded: bool = False
    _cache: Dict[str, int] = {}

    @classmethod
    def _load_database(cls):
        if cls._loaded:
            return
        data_path = Path(__file__).parent / "cpu.csv"
        if not data_path.exists():
            data_path = Path(__file__).parent / "data" / "cpu.csv"

        if not data_path.exists():
            print(f"WARNING: {data_path} not found, CPU scores will be 0")
            cls._loaded = True
            return

        mobile_suffixes = ("H", "HX", "HK", "HS", "U", "P", "G", "M", "HQ", "MQ", "MX")
        laptop_max = 0

        with open(data_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                cpu_name = row["cpu"].strip()
                cpu_lower = cpu_name.lower()
                mark = int(row["mark"])
                if cpu_lower not in cls._cpu_db or mark > cls._cpu_db[cpu_lower]:
                    cls._cpu_db[cpu_lower] = mark
                if any(cpu_name.upper().endswith(s) for s in mobile_suffixes):
                    laptop_max = max(laptop_max, mark)
                elif (
                    "Apple M" in cpu_name
                    or "M1" in cpu_name
                    or "M2" in cpu_name
                    or "M3" in cpu_name
                    or "M4" in cpu_name
                ):
                    laptop_max = max(laptop_max, mark)

        if cls._cpu_db:
            cls._max_score = laptop_max if laptop_max > 0 else max(cls._cpu_db.values())
        cls._loaded = True
        print(
            f"Loaded {len(cls._cpu_db)} CPU benchmarks (laptop max: {cls._max_score})"
        )

    @classmethod
    def _find_matches(cls, query: str) -> List[Tuple[str, int]]:
        query_lower = query.lower().strip()

        # 1. Quick exact check
        if query_lower in cls._cpu_db:
            return [(query_lower, cls._cpu_db[query_lower])]

        # 2. Pattern based search
        query_escaped = re.escape(query_lower)
        pattern = rf"(?:^|[\s\-])({query_escaped})(?:[\s\-@]|$)"

        matches = [
            (n, s) for n, s in cls._cpu_db.items() if re.search(pattern, n)
        ]
        if matches:
            return sorted(matches, key=lambda x: x[1], reverse=True)

        # 3. Substring match
        matches = [(n, s) for n, s in cls._cpu_db.items() if query_lower in n]
        if matches:
            return sorted(matches, key=lambda x: x[1], reverse=True)

        # 4. Token match
        tokens = [t for t in re.split(r"[\s\-]+", query_lower) if len(t) >= 1]
        if tokens:
            matches = [
                (n, s)
                for n, s in cls._cpu_db.items()
                if all(t in n for t in tokens)
            ]
            if matches:
                return sorted(matches, key=lambda x: x[1], reverse=True)
        return []

    @classmethod
    def get_score(cls, cpu: str) -> int:
        cls._load_database()
        if not cls._cpu_db or not cpu or cpu == "Unknown":
            return 0

        # Check cache first
        if cpu in cls._cache:
            return cls._cache[cpu]

        matches = cls._find_matches(cpu)
        if not matches:
            cls._cache[cpu] = 0
            return 0

        avg_score = sum(s for _, s in matches) / len(matches)
        normalized = int((avg_score / cls._max_score) * 1000)

        cls._cache[cpu] = normalized
        return normalized


# =========================================================================
# GPU SCORING
# =========================================================================

GPU_SCORES = {
    "RTX 5090": 1000,
    "RTX 4090": 1000,
    "RTX 5080": 950,
    "RTX 4080": 950,
    "RTX 5070": 900,
    "RTX 4070": 880,
    "RTX 3080": 870,
    "RTX 4070 TI": 890,
    "RTX 3070 TI": 850,
    "RTX 3070": 840,
    "RTX 2080": 820,
    "RTX 4060": 780,
    "RTX 3060": 720,
    "RTX 5060": 800,
    "RTX 4050": 700,
    "RTX 2070": 690,
    "RTX 2060": 650,
    "RTX 3050": 550,
    "RTX 3050 TI": 580,
    "GTX 1660": 520,
    "GTX 1660 TI": 540,
    "GTX 1650": 420,
    "GTX 1650 TI": 440,
    "GTX 1050": 350,
    "GTX 1050 TI": 370,
    "MX550": 350,
    "MX450": 330,
    "MX350": 310,
    "MX330": 300,
    "MX250": 280,
    "MX150": 260,
    "MX130": 250,
    "INTEL IRIS XE": 220,
    "INTEL IRIS PLUS": 200,
    "INTEL IRIS": 190,
    "APPLE GPU": 250,
    "RADEON 780M": 230,
    "RADEON 680M": 210,
    "INTEL UHD": 120,
    "INTEL UHD 620": 110,
    "INTEL UHD 630": 130,
    "UHD GRAPHICS": 110,
    "AMD RADEON": 130,
    "RADEON GRAPHICS": 120,
}


def gpu_score(gpu_name: str, gpu_vram: Optional[float] = None) -> int:
    if not gpu_name or gpu_name == "Unknown":
        return 50
    g = gpu_name.upper().strip()
    base = GPU_SCORES.get(g, None)
    if base is None:
        if "RTX 50" in g:
            base = 850
        elif "RTX 40" in g:
            base = 750
        elif "RTX 30" in g:
            base = 600
        elif "RTX 20" in g:
            base = 500
        elif "RTX" in g:
            base = 550
        elif "GTX 16" in g:
            base = 450
        elif "GTX 10" in g:
            base = 350
        elif "GTX" in g:
            base = 400
        elif "QUADRO" in g:
            base = 450
        elif "MX" in g:
            base = 300
        elif "RADEON RX" in g or "RX " in g:
            base = 500
        elif "IRIS" in g:
            base = 200
        elif "UHD" in g:
            base = 120
        elif "APPLE" in g:
            base = 250
        elif "RADEON" in g:
            base = 130
        elif "INTEL" in g:
            base = 100
        else:
            base = 50
    vram_bonus = 0
    if gpu_vram:
        if gpu_vram >= 12:
            vram_bonus = 50
        elif gpu_vram >= 8:
            vram_bonus = 35
        elif gpu_vram >= 6:
            vram_bonus = 20
        elif gpu_vram >= 4:
            vram_bonus = 10
    return min(1000, base + vram_bonus)


# =========================================================================
# RAM SCORING
# =========================================================================

RAM_SCORES = {
    0: 0,
    2: 100,
    4: 250,
    6: 350,
    8: 500,
    12: 650,
    16: 780,
    24: 870,
    32: 930,
    48: 970,
    64: 1000,
    128: 1000,
}


def ram_score(ram_gb: float) -> int:
    if not ram_gb or ram_gb <= 0:
        return 0
    ram_gb = int(ram_gb)
    if ram_gb >= 64:
        return 1000
    keys = sorted(RAM_SCORES.keys())
    for i, k in enumerate(keys):
        if ram_gb <= k:
            if i == 0:
                return RAM_SCORES[k]
            lower_k, upper_k = keys[i - 1], k
            lower_v, upper_v = RAM_SCORES[lower_k], RAM_SCORES[k]
            ratio = (ram_gb - lower_k) / (upper_k - lower_k)
            return int(lower_v + ratio * (upper_v - lower_v))
    return 1000


# =========================================================================
# STORAGE SCORING
# =========================================================================


def storage_score(storage_gb: float, is_ssd: float) -> int:
    if not storage_gb or storage_gb <= 0:
        return 0
    base = min(1000, int(150 * math.log2(max(1.0, float(storage_gb) / 64.0))))
    multiplier = 1.0 if (is_ssd and is_ssd > 0) else 0.6
    return int(base * multiplier)


# =========================================================================
# SCREEN SCORING
# =========================================================================

SCREEN_SIZE_SCORES = {
    11: 200,
    12: 250,
    13: 350,
    14: 450,
    15: 400,
    16: 450,
    17: 380,
    18: 350,
}


def screen_score(screen_size, refresh_rate, is_touchscreen) -> int:
    score = 0
    if screen_size:
        score += SCREEN_SIZE_SCORES.get(int(round(screen_size)), 300)
    else:
        score += 250
    if refresh_rate:
        if refresh_rate >= 240:
            score += 500
        elif refresh_rate >= 165:
            score += 400
        elif refresh_rate >= 144:
            score += 320
        elif refresh_rate >= 120:
            score += 220
        elif refresh_rate >= 90:
            score += 140
        else:
            score += 50
    else:
        score += 50
    if is_touchscreen and is_touchscreen > 0:
        score += 150
    return min(1000, score)


# =========================================================================
# CONDITION SCORING
# =========================================================================

BRAND_BONUS = {
    "Apple": 100,
    "Microsoft": 80,
    "Dell": 70,
    "Hp": 70,
    "Lenovo": 70,
    "Asus": 55,
    "Msi": 55,
    "Razer": 60,
    "Acer": 40,
    "Samsung": 50,
    "Huawei": 45,
    "Lg": 45,
    "Gigabyte": 50,
    "Toshiba": 35,
}


def condition_score(is_new, brand) -> int:
    score = 800 if (is_new and is_new > 0) else 100
    bonus = BRAND_BONUS.get(brand, 30) if brand else 30
    return min(1000, int((score + bonus) * 1.25))


# =========================================================================
# COMBINED LAPTOP SCORE
# =========================================================================

WEIGHTS = {
    "cpu": 0.35,
    "gpu": 0.25,
    "ram": 0.12,
    "storage": 0.08,
    "screen": 0.10,
    "condition": 0.10,
}


def calc_laptop_score(row: dict) -> int:
    cs = CPUScorer.get_score(row.get("cpu") or "")
    gs = gpu_score(row.get("gpu") or "", row.get("gpu_vram"))
    rs = ram_score(row.get("ram") or 0)
    ss = storage_score(row.get("storage") or 0, row.get("ssd") or 0)
    scr = screen_score(
        row.get("screen_size"), row.get("refresh_rate"), row.get("touchscreen")
    )
    cond = condition_score(row.get("new"), row.get("brand"))

    return int(
        min(
            1500.0,
            float(cs) * WEIGHTS["cpu"]
            + float(gs) * WEIGHTS["gpu"]
            + float(rs) * WEIGHTS["ram"]
            + float(ss) * WEIGHTS["storage"]
            + float(scr) * WEIGHTS["screen"]
            + float(cond) * WEIGHTS["condition"],
        )
    )

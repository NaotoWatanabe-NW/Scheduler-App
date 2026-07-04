"""日本の祝日と営業日の計算

frontend/js/util.js の jpHolidays と同じアルゴリズム。
1980〜2099年の範囲で有効な近似計算（春分・秋分は天文計算の近似式）。
"""
from datetime import date, timedelta
from functools import lru_cache


def _nth_monday(year: int, month: int, n: int) -> date:
    """指定月の第n月曜日"""
    first = date(year, month, 1)
    offset = (7 - first.weekday()) % 7  # weekday(): 月=0
    return date(year, month, 1 + offset + (n - 1) * 7)


@lru_cache(maxsize=None)
def holidays_for_year(year: int) -> frozenset:
    """指定年の祝日（振替休日・国民の休日を含む）"""
    hs = set()

    def equinox(base: float) -> int:
        return int(base + 0.242194 * (year - 1980) - (year - 1980) // 4)

    hs.add(date(year, 1, 1))                 # 元日
    hs.add(_nth_monday(year, 1, 2))          # 成人の日
    hs.add(date(year, 2, 11))                # 建国記念の日
    hs.add(date(year, 2, 23))                # 天皇誕生日
    hs.add(date(year, 3, equinox(20.8431)))  # 春分の日
    hs.add(date(year, 4, 29))                # 昭和の日
    hs.add(date(year, 5, 3))                 # 憲法記念日
    hs.add(date(year, 5, 4))                 # みどりの日
    hs.add(date(year, 5, 5))                 # こどもの日
    hs.add(_nth_monday(year, 7, 3))          # 海の日
    hs.add(date(year, 8, 11))                # 山の日
    hs.add(_nth_monday(year, 9, 3))          # 敬老の日
    hs.add(date(year, 9, equinox(23.2488)))  # 秋分の日
    hs.add(_nth_monday(year, 10, 2))         # スポーツの日
    hs.add(date(year, 11, 3))                # 文化の日
    hs.add(date(year, 11, 23))               # 勤労感謝の日

    # 振替休日: 日曜に当たった祝日の直後の平日（非祝日）
    for h in list(hs):
        if h.weekday() == 6:  # 日曜
            sub = h + timedelta(days=1)
            while sub in hs or sub.weekday() == 6:
                sub += timedelta(days=1)
            hs.add(sub)

    # 国民の休日: 前後を祝日に挟まれた平日
    for h in list(hs):
        if h + timedelta(days=2) in hs:
            mid = h + timedelta(days=1)
            if mid not in hs and mid.weekday() != 6:
                hs.add(mid)

    return frozenset(hs)


def is_holiday(d: date) -> bool:
    return d in holidays_for_year(d.year)


def is_non_working_day(d: date) -> bool:
    """土日または祝日"""
    return d.weekday() >= 5 or is_holiday(d)


def next_working_day(d: date) -> date:
    """d 以降で最も近い営業日（d 自身が営業日なら d）"""
    while is_non_working_day(d):
        d += timedelta(days=1)
    return d


def add_working_days(start: date, n: int) -> date:
    """start を1営業日目として n 営業日目の日付を返す（start は営業日であること）"""
    d = start
    count = 1
    while count < n:
        d = next_working_day(d + timedelta(days=1))
        count += 1
    return d


def prev_working_day(d: date) -> date:
    """d 以前で最も近い営業日（d 自身が営業日なら d）"""
    while is_non_working_day(d):
        d -= timedelta(days=1)
    return d


def sub_working_days(end: date, n: int) -> date:
    """end を最終営業日（n営業日目）として、1営業日目の日付を返す（end は営業日であること）"""
    d = end
    count = 1
    while count < n:
        d = prev_working_day(d - timedelta(days=1))
        count += 1
    return d

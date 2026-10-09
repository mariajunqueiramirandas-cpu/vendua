import math
import os
from pathlib import Path


def cpu_budget() -> int:
    try:
        n = len(os.sched_getaffinity(0))
    except AttributeError:
        n = os.cpu_count() or 1
    # the CPU quota Docker's --cpus / compose `cpus` sets: cgroup v2, else v1
    for quota_file, period_file in (
        ("/sys/fs/cgroup/cpu.max", None),
        ("/sys/fs/cgroup/cpu/cpu.cfs_quota_us", "/sys/fs/cgroup/cpu/cpu.cfs_period_us"),
    ):
        try:
            if period_file:
                quota, period = Path(quota_file).read_text().strip(), Path(period_file).read_text().strip()
            else:
                quota, period = Path(quota_file).read_text().split()
        except (OSError, ValueError):
            continue
        if quota not in ("max", "-1"):
            n = min(n, max(1, math.ceil(int(quota) / int(period))))
        break
    return n


def cpu_has_vnni() -> bool:
    try:
        flags = Path("/proc/cpuinfo").read_text()
    except OSError:
        return False
    return any(f in flags for f in ("avx512_vnni", "avx_vnni", "amx_int8"))

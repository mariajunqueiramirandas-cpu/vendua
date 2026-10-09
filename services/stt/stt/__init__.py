import os

from .cpus import cpu_budget

# numpy's BLAS (the decoder's GEMMs) sizes itself to the visible cores, not the container's CPU
# quota; past the quota its threads only get throttled. Set before anything imports numpy.
os.environ.setdefault("OPENBLAS_NUM_THREADS", os.environ.get("STT_THREADS") or str(cpu_budget()))

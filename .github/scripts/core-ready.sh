#!/usr/bin/env bash
# Waits up to 30 s for the Core a previous step started in the background; its log on failure.
for _ in $(seq 1 150); do
  curl -sf http://localhost:8787/healthz > /dev/null && exit 0
  sleep 0.2
done
echo "::error::Core did not answer /healthz in 30 s"
tail -100 /tmp/core.log
exit 1

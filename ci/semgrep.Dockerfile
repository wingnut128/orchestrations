FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --break-system-packages --no-cache-dir semgrep

WORKDIR /workspace

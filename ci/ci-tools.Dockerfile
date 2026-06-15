FROM cgr.dev/chainguard/wolfi-base:latest

RUN apk add --no-cache \
      nodejs npm bun \
      python-3 py3-pip \
      semgrep \
      git ca-certificates curl

RUN npm install -g --no-fund --no-audit snyk

RUN adduser -D -s /bin/sh ci \
 && mkdir -p /workspace \
 && chown ci:ci /workspace

USER ci
WORKDIR /workspace

# The planning server, for a Hugging Face Space (Docker, free CPU tier).
#
# The Space holds only this file and README.md. At build time it clones the
# public repo's main branch, so to ship a new server version press
# "Factory rebuild" in the Space's settings. Secrets (GROQ_API_KEY, and
# NVIDIA_API_KEY for the fallback) are set in the Space's settings, never here.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@11.25.0

WORKDIR /app
RUN git clone --depth 1 https://github.com/letsbecool9792/skrim-hackspire.git . \
  && pnpm install --frozen-lockfile --filter "@skrim/server..."

# Spaces send traffic to port 7860 (app_port in README.md).
ENV PORT=7860
EXPOSE 7860

# tsx runs the TypeScript directly: the server imports @skrim/schema and
# @skrim/shared as source, which a plain tsc build cannot resolve.
WORKDIR /app/apps/server
CMD ["node", "--import", "tsx", "src/index.ts"]

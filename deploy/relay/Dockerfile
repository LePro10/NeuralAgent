# syntax=docker/dockerfile:1
# Relay image. Build context: repository root. Never built with the test-login feature.

# Landing, admin and web remote (apps/web), served by the relay from /web.
FROM node:24-slim AS web
WORKDIR /src
RUN corepack enable
COPY . .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@neuralagent/web..." && pnpm --filter @neuralagent/web build

FROM rust:1-slim-trixie AS build
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p na-relay && cp target/release/neuralagent-relay /neuralagent-relay

FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --no-create-home relay && mkdir -p /data && chown relay /data
COPY --from=build /neuralagent-relay /usr/local/bin/neuralagent-relay
COPY --from=web /src/apps/web/dist /web
USER relay
ENV NA_RELAY_DB=/data/relay.db NA_RELAY_BIND=0.0.0.0:8080 NA_RELAY_WEB=/web
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --start-interval=2s CMD ["neuralagent-relay", "health"]
ENTRYPOINT ["neuralagent-relay"]

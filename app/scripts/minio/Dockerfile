FROM node:24-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7 AS downloader

ARG TARGETARCH
ARG MINIO_RELEASE
ARG MINIO_SHA256_AMD64
ARG MINIO_SHA256_ARM64
ARG MINIO_CLIENT_RELEASE
ARG MINIO_CLIENT_SHA256_AMD64
ARG MINIO_CLIENT_SHA256_ARM64

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && case "${TARGETARCH}" in \
      amd64) MINIO_SHA256="${MINIO_SHA256_AMD64}"; MINIO_CLIENT_SHA256="${MINIO_CLIENT_SHA256_AMD64}" ;; \
      arm64) MINIO_SHA256="${MINIO_SHA256_ARM64}"; MINIO_CLIENT_SHA256="${MINIO_CLIENT_SHA256_ARM64}" ;; \
      *) exit 1 ;; \
    esac \
    && mkdir -p /downloads /out \
    && cd /downloads \
    && curl --fail --location --silent --show-error --output "minio.${MINIO_RELEASE}" "https://github.com/minio/minio/releases/download/${MINIO_RELEASE}/minio.linux-${TARGETARCH}.${MINIO_RELEASE}" \
    && curl --fail --location --silent --show-error --output "minio.${MINIO_RELEASE}.sha256sum" "https://github.com/minio/minio/releases/download/${MINIO_RELEASE}/minio.linux-${TARGETARCH}.${MINIO_RELEASE}.sha256sum" \
    && test "$(awk '{ print $1 }' "minio.${MINIO_RELEASE}.sha256sum")" = "${MINIO_SHA256}" \
    && sha256sum --check "minio.${MINIO_RELEASE}.sha256sum" \
    && curl --fail --location --silent --show-error --output "mc.${MINIO_CLIENT_RELEASE}" "https://github.com/minio/mc/releases/download/${MINIO_CLIENT_RELEASE}/mc.linux-${TARGETARCH}.${MINIO_CLIENT_RELEASE}" \
    && curl --fail --location --silent --show-error --output "mc.${MINIO_CLIENT_RELEASE}.sha256sum" "https://github.com/minio/mc/releases/download/${MINIO_CLIENT_RELEASE}/mc.linux-${TARGETARCH}.${MINIO_CLIENT_RELEASE}.sha256sum" \
    && test "$(awk '{ print $1 }' "mc.${MINIO_CLIENT_RELEASE}.sha256sum")" = "${MINIO_CLIENT_SHA256}" \
    && sha256sum --check "mc.${MINIO_CLIENT_RELEASE}.sha256sum" \
    && install --mode=0755 "minio.${MINIO_RELEASE}" /out/minio \
    && install --mode=0755 "mc.${MINIO_CLIENT_RELEASE}" /out/mc

FROM node:24-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7

COPY --from=downloader /out/minio /usr/local/bin/minio
COPY --from=downloader /out/mc /usr/local/bin/mc
RUN mkdir -p /data && chown node:node /data
USER node
WORKDIR /data
EXPOSE 9000
ENTRYPOINT ["minio"]

# Build: docker build -t vendua-ig-sidecar services/ig-sidecar
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY *.go ./
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/ig-sidecar .

FROM alpine:3.22
# busybox wget serves the compose healthcheck; CA roots come from the build stage
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN adduser -D -H -u 10001 sidecar
COPY --from=build /out/ig-sidecar /usr/local/bin/ig-sidecar
COPY LICENSE /usr/share/licenses/ig-sidecar/LICENSE
USER sidecar
EXPOSE 8790
ENTRYPOINT ["/usr/local/bin/ig-sidecar"]

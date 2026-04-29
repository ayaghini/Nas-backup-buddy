FROM golang:1.22-alpine AS builder
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY src/ ./src/
RUN go build -o /nasbb-agent ./src

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata coreutils
COPY --from=builder /nasbb-agent /usr/local/bin/nasbb-agent
COPY docker/agent/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]

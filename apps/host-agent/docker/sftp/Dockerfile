FROM alpine:3.19
RUN apk add --no-cache openssh shadow bash jq
RUN addgroup -S nasbb
COPY docker/sftp/sshd_config /etc/ssh/sshd_config
COPY docker/sftp/entrypoint.sh /entrypoint.sh
COPY docker/sftp/reload-watcher.sh /reload-watcher.sh
RUN chmod +x /entrypoint.sh /reload-watcher.sh
EXPOSE 2222
ENTRYPOINT ["/entrypoint.sh"]

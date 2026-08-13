# Strimzi Kafka Connect image with the Debezium PostgreSQL connector baked in.
# Multi-stage: a small alpine stage downloads + unpacks the connector plugin (deterministic,
# no dependency on tools present in the Strimzi base), then it is copied into the Connect image.
# Base tag must match the running Kafka version (Strimzi 1.0.0 / Kafka 4.2.0).
FROM alpine:3.21 AS dl
ARG DBZ_VER=3.1.1.Final
RUN apk add --no-cache curl tar \
 && mkdir -p /plugins/debezium-postgres \
 && curl -fsSL "https://repo1.maven.org/maven2/io/debezium/debezium-connector-postgres/${DBZ_VER}/debezium-connector-postgres-${DBZ_VER}-plugin.tar.gz" \
    | tar -xz -C /plugins/debezium-postgres --strip-components=1

FROM quay.io/strimzi/kafka:1.0.0-kafka-4.2.0
USER root
COPY --from=dl /plugins /opt/kafka/plugins
USER 1001

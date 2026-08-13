# Single-host Greengage (open-source Greenplum fork, Apache 2.0) demo cluster.
# The official greengagedb image is amd64-only (no arm64 build exists), so on this Apple-Silicon
# stand it runs under Docker Desktop's amd64 emulation — slow, but fine for a learning demo.
# The base ships GPHOME as a tarball and has no gpadmin user, so we create both here.
# gpstart's host-reachability check uses ssh, so we also set up passwordless self-ssh.
FROM greengagedb/ggdb7_ubuntu:7.5.0
USER root
RUN groupadd -g 1000 gpadmin 2>/dev/null || true \
 && useradd -u 1000 -g 1000 -d /home/gpadmin -s /bin/bash gpadmin 2>/dev/null || true \
 && mkdir -p /usr/local/greenplum-db /run/sshd \
 && tar xzf /home/gpadmin/bin_gpdb/bin_gpdb.tar.gz -C /usr/local/greenplum-db \
 && ssh-keygen -A \
 && chown -R gpadmin:gpadmin /usr/local/greenplum-db /home/gpadmin
# Passwordless self-ssh for gpadmin (gpstart pings each segment host over ssh).
USER gpadmin
RUN mkdir -p ~/.ssh \
 && ssh-keygen -t rsa -N "" -f ~/.ssh/id_rsa -q \
 && cp ~/.ssh/id_rsa.pub ~/.ssh/authorized_keys \
 && printf 'Host *\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null\n' > ~/.ssh/config \
 && chmod 700 ~/.ssh && chmod 600 ~/.ssh/*
USER root
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY gp-cluster.sh /usr/local/bin/gp-cluster.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/gp-cluster.sh
# Expose the toolchain to non-login shells (so `kubectl exec -- psql ...` just works).
ENV GPHOME=/usr/local/greenplum-db
ENV PATH=/usr/local/greenplum-db/bin:$PATH
ENV LD_LIBRARY_PATH=/usr/local/greenplum-db/lib
ENV PGPORT=7000
ENV PGDATABASE=postgres
WORKDIR /home/gpadmin
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

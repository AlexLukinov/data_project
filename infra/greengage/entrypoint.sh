#!/usr/bin/env bash
# Runs as root: start sshd (gpstart's per-host reachability check connects over ssh, so the
# segment host must accept ssh) and make the PVC writable by gpadmin, then hand the cluster
# off to gpadmin — Greenplum/Greengage refuses to run as root.
set -euo pipefail
mkdir -p /run/sshd
[ -f /etc/ssh/ssh_host_rsa_key ] || ssh-keygen -A
/usr/sbin/sshd
chown -R gpadmin:gpadmin /data 2>/dev/null || true
exec runuser -u gpadmin -- /usr/local/bin/gp-cluster.sh

#!/usr/bin/env bash
# Runs as gpadmin. First boot builds a single-host demo cluster (1 coordinator + N primary
# segments, no mirrors) under $COORDINATOR_DATADIR (a PVC); later boots just gpstart it.
# Idempotent — the persisted gpdemo-env.sh marks an initialized cluster.
set -euo pipefail
export HOME=/home/gpadmin
source "$GPHOME/greengage_path.sh"
export COORDINATOR_DATADIR="${COORDINATOR_DATADIR:-/data}"
ENVFILE="$COORDINATOR_DATADIR/gpdemo-env.sh"

if [ ! -f "$ENVFILE" ]; then
  echo ">> first boot: initializing demo cluster under $COORDINATOR_DATADIR"
  rm -rf "$COORDINATOR_DATADIR"/datadirs        # clear any half-finished init
  export NUM_PRIMARY_MIRROR_PAIRS="${NUM_PRIMARY_MIRROR_PAIRS:-2}"
  export WITH_MIRRORS=false
  export DEMO_PORT_BASE="${DEMO_PORT_BASE:-7000}"
  cd /home/gpadmin/gpdb_src/gpAux/gpdemo
  ./demo_cluster.sh
  cp ./gpdemo-env.sh "$ENVFILE"
else
  echo ">> restart: starting the persisted cluster"
  source "$ENVFILE"
  gpstart -a
fi

source "$ENVFILE"       # sets PGPORT + COORDINATOR_DATA_DIRECTORY (paths point into the PVC)
echo ">> Greengage ready on port ${PGPORT:-7000}"
trap 'gpstop -a -M fast || true; exit 0' TERM INT
while true; do sleep 30; done

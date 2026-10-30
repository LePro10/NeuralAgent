#!/bin/zsh
# Local relay (test sign-in, real FCM if the service account exists) and a throwaway daemon for
# testing the Android app in the emulator. Needs `cargo build -p na-daemon` and
# `cargo build -p na-relay --features test-login`, a built `apps/web/dist`, and
# `adb reverse tcp:8095 tcp:8095`. State and logs go to /tmp/na-android.
ROOT=${0:A:h:h}
T=/tmp/na-android
mkdir -p $T/home
cd $ROOT
RUST_LOG=info NA_RELAY_BIND=0.0.0.0:8095 PUBLIC_URL=http://localhost:8095 NA_RELAY_DB=$T/relay.db NA_RELAY_TEST_LOGIN=1 \
  ADMIN_EMAILS=owner@example.com NA_RELAY_WEB=$ROOT/apps/web/dist FCM_SERVICE_ACCOUNT=$HOME/.neuralagent-secrets/firebase-service-account.json \
  target/debug/neuralagent-relay > $T/relay.log 2>&1 &
sleep 1
RUST_LOG=info NEURALAGENT_HOME=$T/home NEURALAGENT_RELAY=http://127.0.0.1:8095 target/debug/neuralagentd serve > $T/daemon.log 2>&1 &
wait

#!/usr/bin/env bash
# Reproducible personal Android build; signing uses gitignored local Gradle configuration.
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci --ignore-scripts
FOLIA_BUILD_REPO=Nishino0525Nanase/folia-android npm run cap:sync:android
cd android
bash ./gradlew assembleRelease

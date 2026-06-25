#!/usr/bin/env bash
# Build the reference Groth16 circuit artifacts with circom + snarkjs.
#
# Prerequisite: the `circom` compiler (https://docs.circom.io/getting-started/installation/).
# snarkjs is installed as a project dependency.
#
# Intermediate outputs go to circuits/build/ (git-ignored). The three small,
# distributable artifacts the prover needs are copied into circuits/artifacts/
# (checked in), so a freshly cloned project produces a real proof out of the box.
set -euo pipefail
cd "$(dirname "$0")/.."

CIRCUIT=circuits/multiplier.circom
BUILD=circuits/build
ARTIFACTS=circuits/artifacts
PTAU="$BUILD/pot_final.ptau"
SNARKJS="npx --yes snarkjs"

if ! command -v circom >/dev/null 2>&1; then
  echo "circom is not installed. See https://docs.circom.io/getting-started/installation/"
  exit 1
fi

mkdir -p "$BUILD" "$ARTIFACTS"

echo "==> Compiling circuit"
circom "$CIRCUIT" --r1cs --wasm --output "$BUILD"

echo "==> Powers of Tau (bn128, 2^8 — ample for this tiny circuit)"
$SNARKJS powersoftau new bn128 8 "$BUILD/pot_0000.ptau" -v
$SNARKJS powersoftau contribute "$BUILD/pot_0000.ptau" "$BUILD/pot_0001.ptau" --name="reference" -v -e="reference entropy"
$SNARKJS powersoftau prepare phase2 "$BUILD/pot_0001.ptau" "$PTAU" -v

echo "==> Groth16 setup"
$SNARKJS groth16 setup "$BUILD/multiplier.r1cs" "$PTAU" "$BUILD/multiplier_0000.zkey"
$SNARKJS zkey contribute "$BUILD/multiplier_0000.zkey" "$BUILD/multiplier_final.zkey" --name="reference" -v -e="more reference entropy"
$SNARKJS zkey export verificationkey "$BUILD/multiplier_final.zkey" "$BUILD/verification_key.json"

echo "==> Copying distributable artifacts → $ARTIFACTS"
cp "$BUILD/multiplier_js/multiplier.wasm" "$ARTIFACTS/multiplier.wasm"
cp "$BUILD/multiplier_final.zkey" "$ARTIFACTS/multiplier_final.zkey"
cp "$BUILD/verification_key.json" "$ARTIFACTS/verification_key.json"

echo "==> Done. Distributable artifacts in $ARTIFACTS"

#!/usr/bin/env bash
# Build the reference Groth16 circuit artifacts with circom + snarkjs.
#
# Prerequisite: the `circom` compiler (https://docs.circom.io/getting-started/installation/).
# snarkjs is installed as a project dependency.
#
# Produces circuits/build/{multiplier_js/multiplier.wasm, multiplier_final.zkey,
# verification_key.json}, which the reference prover uses to generate a real
# proof. These artifacts are intentionally NOT committed — build them locally.
set -euo pipefail
cd "$(dirname "$0")/.."

CIRCUIT=circuits/multiplier.circom
BUILD=circuits/build
PTAU="$BUILD/pot12_final.ptau"
SNARKJS="npx snarkjs"

if ! command -v circom >/dev/null 2>&1; then
  echo "circom is not installed. See https://docs.circom.io/getting-started/installation/"
  exit 1
fi

mkdir -p "$BUILD"

echo "==> Compiling circuit"
circom "$CIRCUIT" --r1cs --wasm --output "$BUILD"

echo "==> Powers of Tau (bn128, small)"
$SNARKJS powersoftau new bn128 12 "$BUILD/pot12_0000.ptau" -v
$SNARKJS powersoftau contribute "$BUILD/pot12_0000.ptau" "$BUILD/pot12_0001.ptau" --name="reference" -v -e="reference entropy"
$SNARKJS powersoftau prepare phase2 "$BUILD/pot12_0001.ptau" "$PTAU" -v

echo "==> Groth16 setup"
$SNARKJS groth16 setup "$BUILD/multiplier.r1cs" "$PTAU" "$BUILD/multiplier_0000.zkey"
$SNARKJS zkey contribute "$BUILD/multiplier_0000.zkey" "$BUILD/multiplier_final.zkey" --name="reference" -v -e="more reference entropy"
$SNARKJS zkey export verificationkey "$BUILD/multiplier_final.zkey" "$BUILD/verification_key.json"

echo "==> Done. Artifacts in $BUILD"

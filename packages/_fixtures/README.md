# Cross-language test fixtures

`golden.json` is generated from the reference TypeScript implementation
(`@qorechain/rdk`) and asserted against by the Python, Go, and Rust test suites
to guarantee cross-language parity (address derivation, message proto bytes,
denomination math, economics, and Merkle proofs).

The mnemonic and key in this file are the well-known public BIP-39 test vector
("abandon … about"). They are for tests only — never use them for real funds.

`v328.json` holds vectors for chain v3.2.8 features, produced from the chain's
own definitions rather than from this kit: inbox accumulator and range
commitments and a private-rollup envelope (ML-KEM-1024, deterministic test
randomness: byte `i` of the stream is byte `i mod 32` of
`SHA-256("qorechain-rdk-test-rand" || be64(i / 32))`), the proto bytes of the
new and extended `rdk` messages, and BLS12-381 scalar canonical-input cases.
The ML-KEM keys are derived from public test seeds; never use them for real data.

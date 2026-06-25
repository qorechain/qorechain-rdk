# Cross-language test fixtures

`golden.json` is generated from the reference TypeScript implementation
(`@qorechain/rdk`) and asserted against by the Python, Go, and Rust test suites
to guarantee cross-language parity (address derivation, message proto bytes,
denomination math, economics, and Merkle proofs).

The mnemonic and key in this file are the well-known public BIP-39 test vector
("abandon … about"). They are for tests only — never use them for real funds.

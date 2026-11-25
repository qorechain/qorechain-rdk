---
"@qorechain/rdk": minor
"@qorechain/rdk-cli": minor
---

Watchtower for qledger-v1 rollups: `qledgerValidator` and `qledgerFraudProofForBatch` judge a batch the way the chain does, by re-executing its inbox entries from the parent state and deciding the proof with `checkQledgerFraud`. `transitionRootValidator` reported every honest qledger-v1 batch as invalid. `validatorForRollup` picks the rule by execution VM, and `qorollup watchtower --canonical` now uses it.

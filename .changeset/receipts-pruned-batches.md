---
"@qorechain/rdk": patch
---

`verifySettlementReceipt` keeps verifying a receipt after the chain prunes its finalized batch record (`finalized_batch_retention_blocks`, about 7 days on testnet). Once the batch is not found and its own anchor (layer height = batch index) is older than the retention window, the batch's state root is read from that anchor; every other check still runs, nothing is taken from the receipt, and the result carries `batchRecordPruned: true`. A missing batch with a younger anchor still fails.

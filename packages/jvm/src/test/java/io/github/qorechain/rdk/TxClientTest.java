package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.rdk.accounts.Account;
import io.github.qorechain.rdk.accounts.Accounts;
import io.github.qorechain.rdk.config.Enums.RollupStatus;
import io.github.qorechain.rdk.tx.Messages.CreateRollupInput;
import io.github.qorechain.rdk.tx.MockTxClient;
import io.github.qorechain.rdk.tx.Msg;
import io.github.qorechain.rdk.tx.RdkTxClient;
import io.github.qorechain.rdk.tx.Tx;
import io.github.qorechain.rdk.tx.TxBackend.TxParams;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class TxClientTest {

    private static TxParams params() {
        TxParams p = new TxParams();
        p.sequence = 0;
        p.accountNumber = 0;
        p.fee = new Tx.Fee(List.of(new Tx.Coin("uqor", "2000")), 120000);
        p.memo = "";
        return p;
    }

    @Test
    void mockRecordsCreateAndFullLifecycle() {
        Golden g = Golden.load();
        Account acc = Accounts.deriveNativeAccount(g.mnemonic, 0);
        MockTxClient mock = new MockTxClient();
        RdkTxClient client = new RdkTxClient(acc, "qorechain-diana", null).withBackend(mock);

        CreateRollupInput create = new CreateRollupInput();
        create.rollupId = "my-rollup";
        create.profile = "defi";
        create.vmType = "evm";
        create.stakeAmount = 10000000000L;
        Map<String, Object> createResp =
                client.broadcast(List.<Msg>of(client.createRollup(create)), params());
        @SuppressWarnings("unchecked")
        Map<String, Object> txResponse = (Map<String, Object>) createResp.get("tx_response");
        assertEquals("MOCK_TX_HASH", txResponse.get("txhash"));

        // Full pause/resume/stop lifecycle with status guards.
        client.broadcast(List.<Msg>of(client.pauseRollup("my-rollup", "maintenance", RollupStatus.ACTIVE)), params());
        client.broadcast(List.<Msg>of(client.resumeRollup("my-rollup", RollupStatus.PAUSED)), params());
        client.broadcast(List.<Msg>of(client.stopRollup("my-rollup", RollupStatus.PAUSED)), params());

        assertEquals(4, mock.calls.size());
        assertEquals(acc.address, mock.calls.get(0).signer);
    }

    @Test
    void lifecycleGuardRejectsInvalidTransition() {
        Golden g = Golden.load();
        Account acc = Accounts.deriveNativeAccount(g.mnemonic, 0);
        RdkTxClient client = new RdkTxClient(acc, "qorechain-diana", null).withBackend(new MockTxClient());
        // Cannot resume a rollup that is active.
        assertThrows(
                IllegalStateException.class,
                () -> client.resumeRollup("my-rollup", RollupStatus.ACTIVE));
    }

    @Test
    void mockSimulateReturnsGasEstimate() {
        Golden g = Golden.load();
        Account acc = Accounts.deriveNativeAccount(g.mnemonic, 0);
        MockTxClient mock = new MockTxClient(99999, null);
        RdkTxClient client = new RdkTxClient(acc, "qorechain-diana", null).withBackend(mock);
        CreateRollupInput create = new CreateRollupInput();
        create.rollupId = "r";
        create.profile = "defi";
        create.vmType = "evm";
        create.stakeAmount = 1;
        long gas = client.simulate(List.<Msg>of(client.createRollup(create)), params());
        assertEquals(99999, gas);
        // simulate should not record a broadcast call.
        assertTrue(mock.calls.isEmpty());
    }
}

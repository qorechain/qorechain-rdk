package rdk

import (
	"context"
	"testing"
)

func TestMockTxClientRecordsCreateAndLifecycle(t *testing.T) {
	acc := Account{Address: "qor1creator"}
	mock := NewMockTxClient(MockTxClientOptions{})
	client := NewRdkTxClient(acc, "qorechain-diana", nil).WithBackend(mock)
	ctx := context.Background()
	fee := Fee{Amount: []Coin{{Denom: "uqor", Amount: "1000"}}, GasLimit: 200000}

	// Create.
	createMsg := client.CreateRollup(CreateRollupInput{RollupID: "r1", Profile: "defi", VmType: "evm", StakeAmount: 1})
	resp, err := client.Broadcast(ctx, []Msg{createMsg}, TxParams{Fee: fee, Memo: "create"})
	if err != nil {
		t.Fatal(err)
	}
	txResp := asRecord(resp["tx_response"])
	if asStr(txResp["txhash"], "") != "MOCK_TX_HASH" || asNum(txResp["code"], -1) != 0 {
		t.Errorf("unexpected mock response: %+v", resp)
	}

	// Lifecycle: pause, resume, stop.
	pauseMsg, err := client.PauseRollup("r1", "maintenance", RollupActive)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Broadcast(ctx, []Msg{pauseMsg}, TxParams{Fee: fee, Memo: "pause"}); err != nil {
		t.Fatal(err)
	}
	resumeMsg, err := client.ResumeRollup("r1", RollupPaused)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Broadcast(ctx, []Msg{resumeMsg}, TxParams{Fee: fee}); err != nil {
		t.Fatal(err)
	}
	stopMsg, err := client.StopRollup("r1", RollupActive)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Broadcast(ctx, []Msg{stopMsg}, TxParams{Fee: fee}); err != nil {
		t.Fatal(err)
	}

	if len(mock.Calls) != 4 {
		t.Fatalf("expected 4 recorded calls, got %d", len(mock.Calls))
	}
	for i, call := range mock.Calls {
		if call.Signer != "qor1creator" {
			t.Errorf("call %d signer = %q, want qor1creator", i, call.Signer)
		}
		if len(call.Messages) != 1 {
			t.Errorf("call %d recorded %d messages, want 1", i, len(call.Messages))
		}
	}
	if mock.Calls[0].Memo != "create" || mock.Calls[1].Memo != "pause" {
		t.Errorf("memos not recorded: %q, %q", mock.Calls[0].Memo, mock.Calls[1].Memo)
	}
	if mock.Calls[0].Messages[0].TypeURL() != TypeURLMsgCreateRollup {
		t.Errorf("first call type url = %q", mock.Calls[0].Messages[0].TypeURL())
	}
	if mock.Calls[3].Messages[0].TypeURL() != TypeURLMsgStopRollup {
		t.Errorf("last call type url = %q", mock.Calls[3].Messages[0].TypeURL())
	}
}

func TestMockTxClientSimulate(t *testing.T) {
	acc := Account{Address: "qor1creator"}
	mock := NewMockTxClient(MockTxClientOptions{GasEstimate: 250000})
	client := NewRdkTxClient(acc, "qorechain-diana", nil).WithBackend(mock)

	gas, err := client.Simulate(context.Background(),
		[]Msg{client.CreateRollup(CreateRollupInput{RollupID: "r1", Profile: "defi", VmType: "evm", StakeAmount: 1})},
		TxParams{})
	if err != nil {
		t.Fatal(err)
	}
	if gas != 250000 {
		t.Errorf("simulate gas = %d, want 250000", gas)
	}
	// Simulate must not record a broadcast call.
	if len(mock.Calls) != 0 {
		t.Errorf("simulate should not record calls, got %d", len(mock.Calls))
	}
}

func TestMockTxClientDefaultGasEstimate(t *testing.T) {
	mock := NewMockTxClient(MockTxClientOptions{})
	if mock.GasEstimate != 120000 {
		t.Errorf("default gas estimate = %d, want 120000", mock.GasEstimate)
	}
}

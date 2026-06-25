package rdk

import "testing"

func TestMsgProtoGolden(t *testing.T) {
	g := loadGolden(t)

	createRollup := MsgCreateRollup{
		Creator: "qor1creator", RollupID: "my-rollup", Profile: "defi",
		VmType: "evm", StakeAmount: 10000000000,
	}
	pauseRollup := MsgPauseRollup{Creator: "qor1creator", RollupID: "r1", Reason: "x"}
	submitBatch := MsgSubmitBatch{
		Sequencer: "qor1seq", RollupID: "r", BatchIndex: 7,
		StateRoot: []byte{0x01, 0x02, 0x03}, PrevStateRoot: []byte{0x04, 0x05},
		TxCount: 42, DataHash: []byte{0x09, 0x09}, Proof: []byte{0x08},
		WithdrawalsRoot: []byte{0x07, 0x07, 0x07},
	}
	executeWithdrawal := MsgExecuteWithdrawal{
		Submitter: "qor1sub", RollupID: "r", BatchIndex: 3, WithdrawalIndex: 1,
		Recipient: "qor1dest", Denom: "uqor", Amount: 500,
		Proof: [][]byte{{0x01}, {0x02, 0x02}},
	}

	cases := map[string][]byte{
		"MsgCreateRollup":      createRollup.Marshal(),
		"MsgPauseRollup":       pauseRollup.Marshal(),
		"MsgSubmitBatch":       submitBatch.Marshal(),
		"MsgExecuteWithdrawal": executeWithdrawal.Marshal(),
	}
	for name, got := range cases {
		want, ok := g.MsgProtoHex[name]
		if !ok {
			t.Fatalf("golden missing %s", name)
		}
		if BytesToHex(got) != want {
			t.Errorf("%s proto:\n got %s\nwant %s", name, BytesToHex(got), want)
		}
	}
}

func TestMsgTypeURLs(t *testing.T) {
	cases := map[string]string{
		MsgCreateRollup{}.TypeURL():      "/qorechain.rdk.v1.MsgCreateRollup",
		MsgSubmitBatch{}.TypeURL():       "/qorechain.rdk.v1.MsgSubmitBatch",
		MsgChallengeBatch{}.TypeURL():    "/qorechain.rdk.v1.MsgChallengeBatch",
		MsgResolveChallenge{}.TypeURL():  "/qorechain.rdk.v1.MsgResolveChallenge",
		MsgPauseRollup{}.TypeURL():       "/qorechain.rdk.v1.MsgPauseRollup",
		MsgResumeRollup{}.TypeURL():      "/qorechain.rdk.v1.MsgResumeRollup",
		MsgStopRollup{}.TypeURL():        "/qorechain.rdk.v1.MsgStopRollup",
		MsgExecuteWithdrawal{}.TypeURL(): "/qorechain.rdk.v1.MsgExecuteWithdrawal",
	}
	for got, want := range cases {
		if got != want {
			t.Errorf("type url got %s want %s", got, want)
		}
	}
}

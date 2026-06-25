package rdk

// RollupConfigBuilder is a fluent builder for a RollupConfig. Presets return a
// builder pre-filled with their defaults; override fields with Set, inspect with
// ValidationResult, and produce a config with Build or an on-chain create message
// with ToCreateMsg.
type RollupConfigBuilder struct {
	config RollupConfig
}

// NewRollupConfigBuilder creates a builder seeded with an initial config.
func NewRollupConfigBuilder(initial RollupConfig) *RollupConfigBuilder {
	return &RollupConfigBuilder{config: cloneConfig(initial)}
}

func cloneSequencerParams(p *SequencerParams) *SequencerParams {
	if p == nil {
		return nil
	}
	cp := *p
	return &cp
}

func cloneConfig(c RollupConfig) RollupConfig {
	c.SequencerParams = cloneSequencerParams(c.SequencerParams)
	return c
}

// Set merges field overrides. Nested SequencerParams are merged, not replaced.
// A non-nil override pointer field replaces the corresponding value; zero values
// in the override struct fields are ignored where they would clobber set state.
//
// To make merging predictable, Set takes a function that mutates a copy of the
// current config. This mirrors the TypeScript builder's partial-merge semantics
// while staying idiomatic in Go.
func (b *RollupConfigBuilder) Set(mutate func(c *RollupConfig)) *RollupConfigBuilder {
	next := cloneConfig(b.config)
	mutate(&next)
	b.config = next
	return b
}

// SetRollupID sets the rollup id.
func (b *RollupConfigBuilder) SetRollupID(id string) *RollupConfigBuilder {
	b.config.RollupID = id
	return b
}

// SetStakeAmountUqor sets the committed stake, in uqor.
func (b *RollupConfigBuilder) SetStakeAmountUqor(stake string) *RollupConfigBuilder {
	b.config.StakeAmountUqor = stake
	return b
}

// MergeSequencerParams merges the given params onto the current ones.
func (b *RollupConfigBuilder) MergeSequencerParams(p SequencerParams) *RollupConfigBuilder {
	cur := b.config.SequencerParams
	if cur == nil {
		cp := p
		b.config.SequencerParams = &cp
		return b
	}
	if p.SequencerAddress != "" {
		cur.SequencerAddress = p.SequencerAddress
	}
	if p.SharedSetMinSize != nil {
		cur.SharedSetMinSize = p.SharedSetMinSize
	}
	if p.InclusionDelay != nil {
		cur.InclusionDelay = p.InclusionDelay
	}
	if p.PriorityFeeShare != "" {
		cur.PriorityFeeShare = p.PriorityFeeShare
	}
	return b
}

// Get returns a snapshot copy of the current (not necessarily valid) config.
func (b *RollupConfigBuilder) Get() RollupConfig {
	return cloneConfig(b.config)
}

// ValidationResult returns the structured validation result for the current
// configuration.
func (b *RollupConfigBuilder) ValidationResult() ValidationResult {
	return ValidateRollupConfig(b.config)
}

// Validate validates, returning a *RollupConfigError on any error.
func (b *RollupConfigBuilder) Validate() error {
	return AssertValidRollupConfig(b.config)
}

// Build validates and returns a copy of the configuration.
func (b *RollupConfigBuilder) Build() (RollupConfig, error) {
	if err := AssertValidRollupConfig(b.config); err != nil {
		return RollupConfig{}, err
	}
	return cloneConfig(b.config), nil
}

// ToCreateMsg builds the inputs for an on-chain MsgCreateRollup. It requires a
// stake amount, either on the config (StakeAmountUqor) or via stakeAmount. Read
// the minimum from the chain with the params query surface.
func (b *RollupConfigBuilder) ToCreateMsg(creator string, stakeAmount string) (CreateRollupMsgInput, error) {
	if err := AssertValidRollupConfig(b.config); err != nil {
		return CreateRollupMsgInput{}, err
	}
	stake := stakeAmount
	if stake == "" {
		stake = b.config.StakeAmountUqor
	}
	if stake == "" {
		return CreateRollupMsgInput{}, &RollupConfigError{Errors: []string{
			"a stake amount is required to build a create message; set stakeAmountUqor or pass " +
				"stakeAmount (read the minimum from the params query)",
		}}
	}
	return CreateRollupMsgInput{
		Creator:     creator,
		RollupID:    b.config.RollupID,
		Profile:     b.config.Profile,
		VmType:      b.config.VmType,
		StakeAmount: stake,
	}, nil
}

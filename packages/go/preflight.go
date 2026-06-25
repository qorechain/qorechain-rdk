package rdk

import (
	"context"
	"fmt"
	"math/big"
)

// CheckStatus is the status of a single preflight check.
type CheckStatus string

const (
	// CheckOK indicates the check passed.
	CheckOK CheckStatus = "ok"
	// CheckWarn indicates a non-fatal warning.
	CheckWarn CheckStatus = "warn"
	// CheckFail indicates a hard failure.
	CheckFail CheckStatus = "fail"
)

// PreflightCheck is a single readiness check result.
type PreflightCheck struct {
	ID     string
	Label  string
	Status CheckStatus
	Detail string
	Hint   string
}

// PreflightResult is the aggregate result of the preflight checks.
type PreflightResult struct {
	// OK is true when no check failed (warnings are allowed).
	OK     bool
	Checks []PreflightCheck
}

// PreflightOptions configures the preflight checks.
type PreflightOptions struct {
	// Config is a rollup config to validate. Nil skips the config check.
	Config *RollupConfig
	// SignerAddress is the operator/signer address, to check balance/presence.
	SignerAddress string
	// ExpectedNetwork asserts the client is pointed at this network.
	ExpectedNetwork string
	// FeeBufferUqor is extra uqor required on top of the stake. Empty defaults to
	// 1 QOR (1000000 uqor).
	FeeBufferUqor string
}

// CheckPreflight runs the preflight checks against a client.
func CheckPreflight(ctx context.Context, client *RdkClient, options PreflightOptions) PreflightResult {
	checks := []PreflightCheck{}

	params, err := client.Params(ctx)
	haveParams := err == nil
	if haveParams {
		checks = append(checks, PreflightCheck{
			ID: "rest", Label: "REST endpoint reachable", Status: CheckOK,
			Detail: client.Network.Endpoints.Rest,
		})
		minStakeQor, _ := UqorToQor(params.MinStakeForRollup, 0)
		burnPct := new(big.Float).SetFloat64(0)
		if r, ok := new(big.Float).SetString(params.RollupCreationBurnRate); ok {
			burnPct = r.Mul(r, big.NewFloat(100))
		}
		checks = append(checks, PreflightCheck{
			ID: "params", Label: "Module parameters readable", Status: CheckOK,
			Detail: fmt.Sprintf("min stake %s QOR, burn %s%%", minStakeQor, burnPct.Text('g', -1)),
		})
	} else {
		checks = append(checks, PreflightCheck{
			ID: "rest", Label: "REST endpoint reachable", Status: CheckFail,
			Detail: err.Error(),
			Hint:   "Set QORE_REST_URL to a reachable node REST (LCD) endpoint.",
		})
	}

	if options.ExpectedNetwork != "" {
		match := client.Network.Name == options.ExpectedNetwork
		status := CheckOK
		hint := ""
		if !match {
			status = CheckWarn
			hint = "Expected " + options.ExpectedNetwork + "."
		}
		checks = append(checks, PreflightCheck{
			ID: "network", Label: "Network matches expectation", Status: status,
			Detail: fmt.Sprintf("client is %s (%s)", client.Network.Name, client.Network.ChainID),
			Hint:   hint,
		})
	}

	if options.Config != nil {
		r := ValidateRollupConfig(*options.Config)
		switch {
		case !r.Valid:
			checks = append(checks, PreflightCheck{
				ID: "config", Label: "Rollup config valid", Status: CheckFail,
				Detail: r.Errors[0], Hint: "Fix the configuration errors before creating.",
			})
		case len(r.Warnings) > 0:
			checks = append(checks, PreflightCheck{
				ID: "config", Label: "Rollup config valid", Status: CheckWarn, Detail: r.Warnings[0],
			})
		default:
			checks = append(checks, PreflightCheck{
				ID: "config", Label: "Rollup config valid", Status: CheckOK,
				Detail: "compatibility matrix satisfied",
			})
		}
	}

	if options.SignerAddress != "" {
		checks = append(checks, PreflightCheck{
			ID: "signer", Label: "Signer configured", Status: CheckOK, Detail: options.SignerAddress,
		})
		if haveParams {
			bal, balErr := client.Rest.GetBalance(ctx, options.SignerAddress, "")
			if balErr != nil {
				checks = append(checks, PreflightCheck{
					ID: "balance", Label: "Balance readable", Status: CheckWarn, Detail: balErr.Error(),
				})
			} else {
				stake, _ := new(big.Int).SetString(params.MinStakeForRollup, 10)
				if stake == nil {
					stake = big.NewInt(0)
				}
				bufStr := options.FeeBufferUqor
				if bufStr == "" {
					bufStr = "1000000"
				}
				buffer, _ := new(big.Int).SetString(bufStr, 10)
				if buffer == nil {
					buffer = big.NewInt(0)
				}
				required := new(big.Int).Add(stake, buffer)
				have, _ := new(big.Int).SetString(bal, 10)
				if have == nil {
					have = big.NewInt(0)
				}
				ok := have.Cmp(required) >= 0
				haveQor, _ := UqorToQor(have.String(), 0)
				reqQor, _ := UqorToQor(required.String(), 0)
				status := CheckOK
				hint := ""
				if !ok {
					status = CheckFail
					hint = "Fund the operator account (see the keys & funding guide)."
				}
				checks = append(checks, PreflightCheck{
					ID: "balance", Label: "Balance covers stake + fees", Status: status,
					Detail: fmt.Sprintf("have %s QOR, need ~%s QOR", haveQor, reqQor), Hint: hint,
				})
			}
		}
	} else {
		checks = append(checks, PreflightCheck{
			ID: "signer", Label: "Signer configured", Status: CheckWarn, Detail: "no signer",
			Hint: "Set QORE_OPERATOR_PRIVATE_KEY_HEX or QORE_MNEMONIC to create/operate.",
		})
	}

	ok := true
	for _, c := range checks {
		if c.Status == CheckFail {
			ok = false
		}
	}
	return PreflightResult{OK: ok, Checks: checks}
}

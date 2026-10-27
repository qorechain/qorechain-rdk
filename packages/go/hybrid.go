package rdk

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	pqc "github.com/qorechain/qorechain-pqc/go"
	sdkaccounts "github.com/qorechain/qorechain-sdk/packages/go/qorechain/accounts"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/authenticator"
	sdkpqc "github.com/qorechain/qorechain-sdk/packages/go/qorechain/pqc"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/signbytes"
	sdktx "github.com/qorechain/qorechain-sdk/packages/go/qorechain/tx"
)

// PqcKeypair is an ML-DSA-87 (Dilithium-5) keypair: the post-quantum half of a
// hybrid signature. Treat SecretKey as a secret. It is the QoreChain SDK's
// keypair type.
type PqcKeypair = sdkpqc.Keypair

// SignBytesVersion selects the hybrid sign-bytes form (the QoreChain SDK's
// signbytes.Version).
type SignBytesVersion = signbytes.Version

// Hybrid sign-bytes forms.
const (
	// SignBytesAuto asks the network which form it expects (the default). It
	// needs the tx client's REST client on the public networks.
	SignBytesAuto SignBytesVersion = signbytes.Auto
	// SignBytesV1 forces the original form.
	SignBytesV1 SignBytesVersion = signbytes.V1
	// SignBytesV2 forces the domain-tagged, chain-bound form.
	SignBytesV2 SignBytesVersion = signbytes.V2
)

// HybridOptions switches an RdkTxClient to hybrid (post-quantum) signing. Every
// transaction the client signs is then built by the QoreChain SDK's hybrid
// builder, which attaches the ML-DSA-87 signature as a tx-body extension
// alongside the classical secp256k1 signature. Both public networks refuse a
// native-lane transaction without it.
type HybridOptions struct {
	// PqcKeypair is the ML-DSA-87 keypair that signs the post-quantum half. It
	// is expected to already be registered on chain for the account unless
	// IncludePqcPublicKey is set. ResolvePqcKeypair / PqcKeypairFromEnv find the
	// right one.
	PqcKeypair PqcKeypair
	// IncludePqcPublicKey embeds the ML-DSA-87 public key in the extension so
	// the chain registers it on first use. Defaults to false.
	IncludePqcPublicKey bool
	// SignBytesVersion is the hybrid sign-bytes form to sign. Empty or
	// SignBytesAuto asks the network over the tx client's REST client (v1 or v2
	// by the chain's applied upgrade); SignBytesV1 / SignBytesV2 force a form.
	SignBytesVersion SignBytesVersion
	// Resolver decides the form for SignBytesAuto and caches the answer. Nil
	// uses one that queries through the tx client's REST transport.
	Resolver *signbytes.Resolver
}

// BuiltTx is a signed transaction ready to broadcast, with the post-quantum
// artifacts of a hybrid build.
type BuiltTx struct {
	// TxRaw is the encoded TxRaw.
	TxRaw []byte
	// PqcSignedMessage is the exact bytes the ML-DSA-87 signature covers (nil
	// for a classical transaction).
	PqcSignedMessage []byte
	// PqcSignature is the ML-DSA-87 signature (nil for a classical transaction).
	PqcSignature []byte
	// SignBytesVersion is the hybrid sign-bytes form used (empty for a
	// classical transaction).
	SignBytesVersion SignBytesVersion
}

// WithHybrid returns a copy of the client that signs every transaction hybrid
// (post-quantum) with opts. When opts.Resolver is nil, the copy gets its own
// resolver that queries through the client's REST transport and caches the
// answer.
func (c *RdkTxClient) WithHybrid(opts HybridOptions) *RdkTxClient {
	copy := *c
	if opts.Resolver == nil {
		opts.Resolver = signbytes.NewResolver(signbytes.ResolverOptions{HTTPClient: httpClientFor(c.Rest)})
	}
	copy.Hybrid = &opts
	return &copy
}

// IsHybrid reports whether this client signs hybrid (post-quantum) transactions.
func (c *RdkTxClient) IsHybrid() bool {
	return c.Hybrid != nil
}

// BuildTx builds and signs a transaction without broadcasting it. With a
// Hybrid configuration it is built by the QoreChain SDK's hybrid builder, with
// the sign-bytes form resolved as configured; otherwise it is the classical
// SIGN_MODE_DIRECT transaction Sign has always produced.
func (c *RdkTxClient) BuildTx(ctx context.Context, messages []Msg, p TxParams) (BuiltTx, error) {
	if c.Hybrid == nil {
		return BuiltTx{TxRaw: SignTx(c.Account, messages, p.Memo, p.Fee, p.Sequence, c.ChainID, p.AccountNumber)}, nil
	}
	version, err := c.resolveSignBytes(ctx, false)
	if err != nil {
		return BuiltTx{}, err
	}
	return c.buildHybrid(messages, p, version)
}

// requestedSignBytes is the configured form, defaulting to auto.
func (c *RdkTxClient) requestedSignBytes() SignBytesVersion {
	if c.Hybrid.SignBytesVersion == "" {
		return SignBytesAuto
	}
	return c.Hybrid.SignBytesVersion
}

// resolveSignBytes decides the hybrid sign-bytes form; refresh bypasses the
// resolver's cache.
func (c *RdkTxClient) resolveSignBytes(ctx context.Context, refresh bool) (SignBytesVersion, error) {
	resolver := c.Hybrid.Resolver
	if resolver == nil {
		resolver = signbytes.NewResolver(signbytes.ResolverOptions{HTTPClient: httpClientFor(c.Rest)})
	}
	restURL := ""
	if c.Rest != nil {
		restURL = c.Rest.BaseURL()
	}
	if refresh {
		return resolver.Refresh(ctx, restURL, c.ChainID, c.requestedSignBytes())
	}
	return resolver.Resolve(ctx, restURL, c.ChainID, c.requestedSignBytes())
}

// buildHybrid builds the hybrid transaction with the SDK, under version.
func (c *RdkTxClient) buildHybrid(messages []Msg, p TxParams, version SignBytesVersion) (BuiltTx, error) {
	sdkMessages := make([]sdktx.Message, 0, len(messages))
	for _, m := range messages {
		sdkMessages = append(sdkMessages, sdktx.Message{TypeURL: m.TypeURL(), Value: encodedMsg{m}})
	}
	coins := make([]sdktx.Coin, 0, len(p.Fee.Amount))
	for _, coin := range p.Fee.Amount {
		coins = append(coins, sdktx.Coin{Denom: coin.Denom, Amount: coin.Amount})
	}
	built, err := sdktx.BuildHybridTx(sdktx.BuildHybridTxParams{
		Account: sdkaccounts.Secp256k1Account{
			Type:       "native",
			Address:    c.Account.Address,
			PublicKey:  c.Account.PublicKey,
			PrivateKey: c.Account.PrivateKey,
		},
		PQCKeypair:          c.Hybrid.PqcKeypair,
		Messages:            sdkMessages,
		Fee:                 sdktx.Fee{Amount: coins, Gas: strconv.FormatUint(p.Fee.GasLimit, 10)},
		ChainID:             c.ChainID,
		AccountNumber:       p.AccountNumber,
		Sequence:            p.Sequence,
		Memo:                p.Memo,
		IncludePQCPublicKey: c.Hybrid.IncludePqcPublicKey,
		SignBytesVersion:    version,
	})
	if err != nil {
		return BuiltTx{}, err
	}
	return BuiltTx{
		TxRaw:            built.TxRawBytes,
		PqcSignedMessage: built.PQCSignedMessage,
		PqcSignature:     built.PQCSignature,
		SignBytesVersion: built.SignBytesVersion,
	}, nil
}

// broadcastHybrid signs hybrid and broadcasts. When the form was resolved
// automatically and the chain refuses the transaction as a hybrid-signature
// failure, the form is resolved again bypassing the cache and, if the network
// now names a different one, the transaction is re-signed and broadcast once
// more.
func (c *RdkTxClient) broadcastHybrid(ctx context.Context, messages []Msg, p TxParams) (map[string]any, error) {
	built, err := c.BuildTx(ctx, messages, p)
	if err != nil {
		return nil, err
	}
	res, err := c.Rest.BroadcastTxBytes(ctx, built.TxRaw)
	if err != nil || !c.requestedSignBytes().IsAuto() || !isHybridRejection(res) {
		return res, err
	}
	fresh, rerr := c.resolveSignBytes(ctx, true)
	if rerr != nil || fresh == built.SignBytesVersion {
		return res, nil
	}
	rebuilt, err := c.buildHybrid(messages, p, fresh)
	if err != nil {
		return nil, err
	}
	return c.Rest.BroadcastTxBytes(ctx, rebuilt.TxRaw)
}

// isHybridRejection reports whether a broadcast response is the chain refusing
// the hybrid signature.
func isHybridRejection(res map[string]any) bool {
	r := asRecord(pick(res, "tx_response", "txResponse"))
	if len(r) == 0 {
		r = res
	}
	code := asU64(pick(r, "code"), 0)
	if code == 0 || code > 0xffffffff {
		return false
	}
	return signbytes.IsHybridRejection(asStr(pick(r, "codespace"), ""), uint32(code), asStr(pick(r, "raw_log", "rawLog"), ""))
}

// encodedMsg presents an rdk message, encoded by this package's codec, to the
// SDK builder. The builder marshals messages through gogoproto, which uses a
// message's own Marshal method when it has one.
type encodedMsg struct{ m Msg }

func (e encodedMsg) Reset()                   {}
func (e encodedMsg) String() string           { return e.m.TypeURL() }
func (e encodedMsg) ProtoMessage()            {}
func (e encodedMsg) Marshal() ([]byte, error) { return e.m.Marshal(), nil }

// doerTransport routes an http.Client's requests through an HTTPDoer.
type doerTransport struct{ doer HTTPDoer }

func (t doerTransport) RoundTrip(req *http.Request) (*http.Response, error) { return t.doer.Do(req) }

// httpClientFor is an *http.Client that sends through the REST client's
// transport, so the sign-bytes query goes where the REST reads go.
func httpClientFor(rest *RestClient) *http.Client {
	if rest == nil {
		return nil
	}
	if hc, ok := rest.http.(*http.Client); ok {
		return hc
	}
	return &http.Client{Transport: doerTransport{rest.http}}
}

// --- post-quantum key resolution ---

// PqcDerivation names which derivation produced an operator's post-quantum key.
type PqcDerivation string

const (
	// PqcDerivationCanonical is the address-bound derivation:
	// shake256("qorechain:pqc:v1|" + address + "|" + mnemonic) seeds ML-DSA-87.
	PqcDerivationCanonical PqcDerivation = "canonical"
	// PqcDerivationLegacy is the older mnemonic-only derivation.
	PqcDerivationLegacy PqcDerivation = "legacy"
	// PqcDerivationSeed is a raw 32-byte ML-DSA-87 seed (QORE_PQC_SEED_HEX).
	PqcDerivationSeed PqcDerivation = "seed"
)

// ResolvedPqcKeypair is the outcome of ResolvePqcKeypair / PqcKeypairFromEnv.
type ResolvedPqcKeypair struct {
	// Keypair is the ML-DSA-87 keypair to sign with.
	Keypair PqcKeypair
	// Derivation is how Keypair was produced.
	Derivation PqcDerivation
	// Registered is true when the chain already holds this key for the account.
	Registered bool
	// IncludePqcPublicKey is true when the account has no key on chain yet, so
	// the first hybrid transaction must carry (and so register) it.
	IncludePqcPublicKey bool
}

// HybridOptions returns the HybridOptions that sign with this keypair (auto
// sign-bytes form).
func (r ResolvedPqcKeypair) HybridOptions() HybridOptions {
	return HybridOptions{PqcKeypair: r.Keypair, IncludePqcPublicKey: r.IncludePqcPublicKey}
}

// ResolvePqcKeypair finds the ML-DSA-87 keypair an account actually uses, by
// asking the chain.
//
// A mnemonic can yield two post-quantum keys, and a wallet may have registered
// either: the canonical one (address-bound,
// shake256("qorechain:pqc:v1|" + account + "|" + mnemonic), what unified
// accounts use) or the legacy one (the older mnemonic-only scheme). Signing with
// the wrong one is not a soft failure: the hybrid signature would not match the
// registered key and every transaction would be refused. So this derives both
// and returns whichever the chain has registered.
//
//   - If the account has no key registered, it returns the canonical key with
//     IncludePqcPublicKey set, so the first transaction registers it.
//   - If the account has a key that neither derivation produces, it returns an
//     error: the key was registered from another secret, and guessing would only
//     cost a refused transaction. Supply that keypair explicitly instead.
func ResolvePqcKeypair(ctx context.Context, client *RdkClient, address, mnemonic string) (ResolvedPqcKeypair, error) {
	canonical, err := authenticator.DerivePQCCanonical(address, mnemonic)
	if err != nil {
		return ResolvedPqcKeypair{}, err
	}
	legacy, err := authenticator.DerivePQCLegacy(mnemonic)
	if err != nil {
		return ResolvedPqcKeypair{}, err
	}
	registeredKey := registeredPqcKey(ctx, client, address)

	switch registeredKey {
	case "":
		return ResolvedPqcKeypair{Keypair: canonical, Derivation: PqcDerivationCanonical, Registered: false, IncludePqcPublicKey: true}, nil
	case BytesToHex(canonical.PublicKey):
		return ResolvedPqcKeypair{Keypair: canonical, Derivation: PqcDerivationCanonical, Registered: true, IncludePqcPublicKey: false}, nil
	case BytesToHex(legacy.PublicKey):
		return ResolvedPqcKeypair{Keypair: legacy, Derivation: PqcDerivationLegacy, Registered: true, IncludePqcPublicKey: false}, nil
	}
	return ResolvedPqcKeypair{}, fmt.Errorf("account %s has a post-quantum key on chain that neither the canonical nor the legacy "+
		"derivation of this mnemonic produces, so it was registered from another secret. Supply that "+
		"keypair explicitly (QORE_PQC_SEED_HEX), or check that the mnemonic belongs to this account.", address)
}

// registeredPqcKey is the account's registered post-quantum public key as
// lowercase hex, or "" when it has none. An account with no record reads as
// "not registered".
func registeredPqcKey(ctx context.Context, client *RdkClient, address string) string {
	view, err := client.Rest.GetPqcAccount(ctx, address)
	if err != nil {
		return ""
	}
	return strings.ToLower(view.PublicKey)
}

// PqcKeypairFromEnv returns the operator's ML-DSA-87 keypair from the
// environment, checked against the chain. The bool is false when no source is
// configured (the caller then signs classical-only, which both public networks
// refuse on the native lane).
//
//   - QORE_MNEMONIC is resolved with ResolvePqcKeypair: whichever of the
//     canonical and legacy derivations the chain has registered.
//   - QORE_PQC_SEED_HEX is a 32-byte ML-DSA-87 seed, for an operator who signs
//     with a raw private key (QORE_OPERATOR_PRIVATE_KEY_HEX) and so has no
//     mnemonic to derive from. It takes precedence when set, is still checked
//     against the chain, and is refused if the account holds a different key.
func PqcKeypairFromEnv(ctx context.Context, client *RdkClient, address string, env map[string]string) (ResolvedPqcKeypair, bool, error) {
	if seedHex := strings.TrimSpace(env["QORE_PQC_SEED_HEX"]); seedHex != "" {
		seed, err := HexToBytes(seedHex)
		if err != nil {
			return ResolvedPqcKeypair{}, true, err
		}
		if len(seed) != 32 {
			return ResolvedPqcKeypair{}, true, fmt.Errorf("QORE_PQC_SEED_HEX must be 32 bytes, got %d", len(seed))
		}
		pub, sec, err := pqc.MLDSA87.KeygenFromSeed(seed)
		if err != nil {
			return ResolvedPqcKeypair{}, true, err
		}
		keypair := PqcKeypair{PublicKey: pub, SecretKey: sec}
		switch registeredPqcKey(ctx, client, address) {
		case "":
			return ResolvedPqcKeypair{Keypair: keypair, Derivation: PqcDerivationSeed, Registered: false, IncludePqcPublicKey: true}, true, nil
		case BytesToHex(pub):
			return ResolvedPqcKeypair{Keypair: keypair, Derivation: PqcDerivationSeed, Registered: true, IncludePqcPublicKey: false}, true, nil
		}
		return ResolvedPqcKeypair{}, true, fmt.Errorf("QORE_PQC_SEED_HEX does not produce the post-quantum key registered for %s; "+
			"every hybrid transaction signed with it would be refused", address)
	}
	if mnemonic := strings.TrimSpace(env["QORE_MNEMONIC"]); mnemonic != "" {
		resolved, err := ResolvePqcKeypair(ctx, client, address, mnemonic)
		return resolved, true, err
	}
	return ResolvedPqcKeypair{}, false, nil
}

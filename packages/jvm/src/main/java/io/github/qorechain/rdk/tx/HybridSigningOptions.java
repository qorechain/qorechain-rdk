package io.github.qorechain.rdk.tx;

import io.github.qorechain.pqc.PqcKeypair;
import io.github.qorechain.rdk.accounts.Accounts.ResolvedPqcKeypair;
import io.github.qorechain.tx.SignBytes;

/**
 * Post-quantum signing configuration for {@link RdkTxClient}. Supplying {@link #pqcKeypair}
 * switches the client to the hybrid path; everything else is optional tuning.
 */
public final class HybridSigningOptions {
    /**
     * The ML-DSA-87 (Dilithium-5) keypair providing the post-quantum half of the signature. When
     * present, every transaction the client signs is signed hybrid.
     *
     * <p>The key is expected to already be registered on chain (via {@code MsgRegisterPQCKey})
     * unless {@link #includePqcPublicKey} is set.
     */
    public PqcKeypair pqcKeypair;

    /**
     * Which hybrid sign-bytes form to sign. {@link SignBytes.Mode#AUTO} (the default) asks the
     * network over the client's REST endpoint which form it verifies; {@code V1} / {@code V2}
     * force a form, useful when a network's upgrade plan name differs from what {@code AUTO}
     * looks up.
     */
    public SignBytes.Mode signBytesVersion = SignBytes.Mode.AUTO;

    /**
     * Embed the ML-DSA-87 public key in the extension so the chain can register it on first use.
     * Defaults to {@code false}.
     */
    public boolean includePqcPublicKey;

    public HybridSigningOptions() {}

    /** Hybrid signing with {@code pqcKeypair}, sign-bytes form resolved automatically. */
    public HybridSigningOptions(PqcKeypair pqcKeypair) {
        this.pqcKeypair = pqcKeypair;
    }

    /** Hybrid signing with {@code pqcKeypair}, embedding its public key when asked. */
    public HybridSigningOptions(PqcKeypair pqcKeypair, boolean includePqcPublicKey) {
        this.pqcKeypair = pqcKeypair;
        this.includePqcPublicKey = includePqcPublicKey;
    }

    /**
     * The options for a keypair found by {@link io.github.qorechain.rdk.accounts.Accounts#resolvePqcKeypair}
     * or {@link io.github.qorechain.rdk.accounts.Accounts#pqcKeypairFromEnv}: that key, with its
     * public key embedded exactly when the account has none registered yet.
     */
    public static HybridSigningOptions from(ResolvedPqcKeypair resolved) {
        return new HybridSigningOptions(resolved.keypair, resolved.includePqcPublicKey);
    }

    /** Force a sign-bytes form ({@code null} means {@link SignBytes.Mode#AUTO}). */
    public HybridSigningOptions signBytesVersion(SignBytes.Mode mode) {
        this.signBytesVersion = mode == null ? SignBytes.Mode.AUTO : mode;
        return this;
    }

    HybridSigningOptions copy() {
        HybridSigningOptions c = new HybridSigningOptions(pqcKeypair, includePqcPublicKey);
        c.signBytesVersion = signBytesVersion == null ? SignBytes.Mode.AUTO : signBytesVersion;
        return c;
    }
}

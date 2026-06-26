package io.github.qorechain.rdk.accounts;

/**
 * A derived QoreChain native account. The private key material is held explicitly and is never
 * logged.
 */
public final class Account {
    /** The bech32 ({@code qor}) account address. */
    public final String address;
    /** The 33-byte compressed secp256k1 public key. */
    public final byte[] publicKey;
    /** The 32-byte secp256k1 private key. */
    public final byte[] privateKey;

    public Account(String address, byte[] publicKey, byte[] privateKey) {
        this.address = address;
        this.publicKey = publicKey;
        this.privateKey = privateKey;
    }
}

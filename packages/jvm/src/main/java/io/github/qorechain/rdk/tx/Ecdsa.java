package io.github.qorechain.rdk.tx;

import java.math.BigInteger;
import org.bouncycastle.crypto.params.ECDomainParameters;
import org.bouncycastle.crypto.params.ECPublicKeyParameters;
import org.bouncycastle.crypto.signers.ECDSASigner;
import org.bouncycastle.math.ec.ECPoint;
import org.web3j.crypto.Sign;

/** secp256k1 ECDSA verification and fixed-length integer encoding for signature components. */
final class Ecdsa {
    private Ecdsa() {}

    private static final ECDomainParameters DOMAIN =
            new ECDomainParameters(
                    Sign.CURVE_PARAMS.getCurve(),
                    Sign.CURVE_PARAMS.getG(),
                    Sign.CURVE_PARAMS.getN(),
                    Sign.CURVE_PARAMS.getH());

    /** Verify an ECDSA signature (r, s) over a 32-byte digest against a public point. */
    static boolean verify(byte[] digest, BigInteger r, BigInteger s, ECPoint pub) {
        ECDSASigner signer = new ECDSASigner();
        signer.init(false, new ECPublicKeyParameters(pub, DOMAIN));
        return signer.verifySignature(digest, r, s);
    }

    /** Left-pad/truncate a non-negative BigInteger to a fixed-length big-endian byte array. */
    static byte[] toFixed(BigInteger value, int length) {
        byte[] raw = value.toByteArray();
        if (raw.length == length) {
            return raw;
        }
        byte[] out = new byte[length];
        if (raw.length == length + 1 && raw[0] == 0) {
            System.arraycopy(raw, 1, out, 0, length);
            return out;
        }
        if (raw.length < length) {
            System.arraycopy(raw, 0, out, length - raw.length, raw.length);
            return out;
        }
        System.arraycopy(raw, raw.length - length, out, 0, length);
        return out;
    }
}

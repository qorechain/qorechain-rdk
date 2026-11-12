package io.github.qorechain.rdk.tx;

import com.google.protobuf.Empty;
import com.google.protobuf.InvalidProtocolBufferException;
import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.pqc.KeyIntegrity;
import io.github.qorechain.pqc.PqcDx;
import io.github.qorechain.pqc.PqcKeypair;
import io.github.qorechain.tx.StdFee;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;

/**
 * Hands the RDK's own messages and fee to the QoreChain SDK's hybrid builder.
 *
 * <p>The SDK packs each message as {@code Any{type_url, message.toByteString()}}. An RDK message
 * is already encoded by this package's codec, so it is carried as a field-less protobuf message
 * whose unknown fields are exactly those bytes: the SDK then writes them verbatim. Every message
 * is checked to come back byte-for-byte, so an encoding that would not survive the hand-over is
 * refused rather than signed differently.
 */
final class SdkMessages {
    private SdkMessages() {}

    /** Carry one RDK message, encoded by its own codec, as an SDK {@link TypedMessage}. */
    static TypedMessage typed(Msg msg) {
        byte[] encoded = msg.marshal();
        Empty carrier;
        try {
            carrier = Empty.parseFrom(encoded);
        } catch (InvalidProtocolBufferException e) {
            throw new IllegalArgumentException(
                    msg.typeUrl() + " does not encode to valid protobuf: " + e.getMessage(), e);
        }
        if (!Arrays.equals(carrier.toByteArray(), encoded)) {
            throw new IllegalStateException(
                    msg.typeUrl()
                            + " is not in canonical field order, so it cannot be handed to the hybrid"
                            + " builder unchanged");
        }
        return new TypedMessage(msg.typeUrl(), carrier);
    }

    static List<TypedMessage> typed(List<Msg> messages) {
        List<TypedMessage> out = new ArrayList<>(messages.size());
        for (Msg m : messages) {
            out.add(typed(m));
        }
        return out;
    }

    /** The RDK fee as the SDK's {@link StdFee} (no payer, no granter, as the classical path). */
    static StdFee fee(Tx.Fee fee) {
        List<StdFee.Coin> coins = new ArrayList<>(fee.amount.size());
        for (Tx.Coin c : fee.amount) {
            coins.add(new StdFee.Coin(c.denom, c.amount));
        }
        return new StdFee(coins, Long.toString(fee.gasLimit));
    }

    /** The type URL of the post-quantum key registration this package sends. */
    static final String MSG_REGISTER_PQC_KEY_V2 = "/qorechain.pqc.v1.MsgRegisterPQCKeyV2";

    /**
     * The messages an account with no registered post-quantum key may send on its own (the chain
     * refuses anything else from such an account since v3.2.3).
     */
    static final Set<String> PQC_REGISTRATION_TYPES =
            Set.of(
                    "/qorechain.pqc.v1.MsgRegisterPQCKey",
                    MSG_REGISTER_PQC_KEY_V2,
                    "/qorechain.pqc.v1.MsgMigratePQCKey");

    /** Whether every message is a post-quantum key registration. */
    static boolean isRegistrationOnly(List<Msg> messages) {
        for (Msg m : messages) {
            if (!PQC_REGISTRATION_TYPES.contains(m.typeUrl())) {
                return false;
            }
        }
        return true;
    }

    /** Carry an SDK message as an RDK {@link Msg}: its type URL and its protobuf encoding. */
    static Msg fromSdk(TypedMessage typed) {
        byte[] encoded = typed.message.toByteArray();
        String typeUrl = typed.typeUrl;
        return new Msg() {
            @Override
            public String typeUrl() {
                return typeUrl;
            }

            @Override
            public byte[] marshal() {
                return encoded.clone();
            }
        };
    }

    /**
     * {@code MsgRegisterPQCKeyV2} for {@code sender}: the ML-DSA-87 public key, algorithm 1, key
     * type {@code "hybrid"}, and the key's proof of possession, its signature over {@code
     * "qorechain-pqc-pop-v1|<chainId>|1|<sender>|<hex(public key)>"}. Built by the QoreChain SDK.
     */
    static Msg registerPqcKeyV2(String sender, PqcKeypair keypair, String chainId) {
        PqcDx.Signer signer = new PqcDx.Signer();
        signer.sender = sender;
        signer.pqcKeypair = keypair;
        PqcDx.EnsureOptions opts = new PqcDx.EnsureOptions();
        opts.keyType = PqcDx.DEFAULT_KEY_TYPE;
        opts.proofOfPossession = KeyIntegrity.signProofOfPossession(chainId, sender, keypair);
        TypedMessage typed = PqcDx.buildRegisterPqcKeyMsg(signer, opts);
        if (!MSG_REGISTER_PQC_KEY_V2.equals(typed.typeUrl)) {
            throw new IllegalStateException("unexpected registration message " + typed.typeUrl);
        }
        return fromSdk(typed);
    }
}

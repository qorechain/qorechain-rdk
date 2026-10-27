package io.github.qorechain.rdk.tx;

import com.google.protobuf.Empty;
import com.google.protobuf.InvalidProtocolBufferException;
import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.tx.StdFee;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

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
}

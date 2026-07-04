package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.rdk.config.Enums;
import io.github.qorechain.rdk.config.Enums.VmType;
import io.github.qorechain.rdk.config.RollupConfig;
import io.github.qorechain.rdk.config.Validate;
import io.github.qorechain.rdk.config.ValidationResult;
import io.github.qorechain.rdk.presets.Presets;
import io.github.qorechain.rdk.tx.Messages;
import io.github.qorechain.rdk.tx.Messages.CreateRollupInput;
import io.github.qorechain.rdk.tx.Messages.MsgCreateRollup;
import io.github.qorechain.rdk.util.Bytes;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

/** The "QoreChain Native" vm-type alias. Mirrors the TypeScript {@code vmtype.test.ts}. */
class VmTypeTest {

    @Test
    void advertisesNativeNotCosmwasmInThePublicList() {
        assertTrue(Enums.VM_TYPES.contains("native"));
        assertFalse(Enums.VM_TYPES.contains("cosmwasm"));
    }

    @Test
    void acceptsNativeEvmSvmCustomAndTheCosmwasmLegacyAlias() {
        for (String v : new String[] {"native", "evm", "svm", "custom", "cosmwasm"}) {
            assertTrue(Enums.isVmType(v), () -> v + " should be accepted");
        }
        assertFalse(Enums.isVmType("wasm2"));
        assertFalse(Enums.isVmType(null));
    }

    @Test
    void mapsNativeToTheCosmwasmWireValueOthersPassThrough() {
        assertEquals("cosmwasm", Enums.vmTypeWireValue("native"));
        assertEquals("cosmwasm", Enums.vmTypeWireValue("cosmwasm"));
        assertEquals("evm", Enums.vmTypeWireValue("evm"));
        assertEquals("svm", Enums.vmTypeWireValue("svm"));
        assertEquals("custom", Enums.vmTypeWireValue("custom"));
    }

    @Test
    void labelsTheWasmRuntimeAsQoreChainNative() {
        assertEquals("QoreChain Native", Enums.vmTypeLabel("native"));
        assertEquals("QoreChain Native", Enums.vmTypeLabel("cosmwasm"));
        assertEquals("EVM", Enums.vmTypeLabel("evm"));
        assertEquals("SVM", Enums.vmTypeLabel("svm"));
        assertEquals("Custom", Enums.vmTypeLabel("custom"));
    }

    @Test
    void emitsCosmwasmOnTheWireWhenTheConfigSaysNative() {
        CreateRollupInput in = new CreateRollupInput();
        in.creator = "qor1creator";
        in.rollupId = "r";
        in.profile = "nft";
        in.vmType = "native";
        in.stakeAmount = 1;

        MsgCreateRollup msg = Messages.createRollupMsg(in);
        // The message carries the wire value, never "native".
        assertEquals("cosmwasm", msg.vmType);

        // And the marshalled proto bytes contain "cosmwasm", not "native".
        String hex = Bytes.bytesToHex(msg.marshal());
        assertTrue(hex.contains(asciiHex("cosmwasm")), "proto should encode the cosmwasm wire value");
        assertFalse(hex.contains(asciiHex("native")), "proto must not encode native");
    }

    @Test
    void validatesNativeAndTheNftPresetNowNative() {
        RollupConfig cfg = Presets.nft(c -> c.rollupId = "r").build();
        assertEquals(VmType.NATIVE, cfg.vmType);
        ValidationResult r = Validate.validateRollupConfig(cfg);
        assertTrue(r.valid, () -> "errors: " + r.errors);
    }

    private static String asciiHex(String s) {
        StringBuilder sb = new StringBuilder();
        for (byte b : s.getBytes(StandardCharsets.US_ASCII)) {
            sb.append(String.format("%02x", b & 0xff));
        }
        return sb.toString();
    }
}

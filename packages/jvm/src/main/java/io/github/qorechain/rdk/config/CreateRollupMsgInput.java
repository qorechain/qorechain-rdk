package io.github.qorechain.rdk.config;

import io.github.qorechain.rdk.config.Enums.ProfileName;
import io.github.qorechain.rdk.config.Enums.VmType;

/** Inputs for an on-chain {@code MsgCreateRollup}, as the kit submits them. */
public class CreateRollupMsgInput {
    public final String creator;
    public final String rollupId;
    public final ProfileName profile;
    public final VmType vmType;
    public final String stakeAmount;

    public CreateRollupMsgInput(
            String creator, String rollupId, ProfileName profile, VmType vmType, String stakeAmount) {
        this.creator = creator;
        this.rollupId = rollupId;
        this.profile = profile;
        this.vmType = vmType;
        this.stakeAmount = stakeAmount;
    }
}

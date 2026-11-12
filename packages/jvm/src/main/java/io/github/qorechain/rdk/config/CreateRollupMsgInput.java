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
    /** Chain v3.2.8+: {@code "based"}, or empty. */
    public final String sequencing;
    /** Chain v3.2.8+: {@code "qledger-v1"}, or empty. */
    public final String executionVm;
    /** Chain v3.2.8+: {@code "encapsulated"}, or empty. */
    public final String privacy;

    public CreateRollupMsgInput(
            String creator, String rollupId, ProfileName profile, VmType vmType, String stakeAmount) {
        this(creator, rollupId, profile, vmType, stakeAmount, "", "", "");
    }

    public CreateRollupMsgInput(
            String creator,
            String rollupId,
            ProfileName profile,
            VmType vmType,
            String stakeAmount,
            String sequencing,
            String executionVm,
            String privacy) {
        this.creator = creator;
        this.rollupId = rollupId;
        this.profile = profile;
        this.vmType = vmType;
        this.stakeAmount = stakeAmount;
        this.sequencing = sequencing == null ? "" : sequencing;
        this.executionVm = executionVm == null ? "" : executionVm;
        this.privacy = privacy == null ? "" : privacy;
    }
}

package io.github.qorechain.rdk.config;

/**
 * Mode-specific sequencer parameters. Which fields apply depends on the sequencer mode:
 * {@code dedicated} uses {@code sequencerAddress}, {@code shared} uses {@code sharedSetMinSize},
 * and {@code based} uses {@code inclusionDelay} / {@code priorityFeeShare}.
 */
public class SequencerParams {
    /** {@code dedicated}: the operator address that sequences the rollup. */
    public String sequencerAddress;
    /** {@code shared}: minimum size of the shared sequencer set. */
    public Integer sharedSetMinSize;
    /** {@code based}: blocks of inclusion delay for host-chain proposers. */
    public Integer inclusionDelay;
    /** {@code based}: share of priority fees routed to proposers, as a decimal string. */
    public String priorityFeeShare;

    public SequencerParams() {}

    public SequencerParams copy() {
        SequencerParams p = new SequencerParams();
        p.sequencerAddress = sequencerAddress;
        p.sharedSetMinSize = sharedSetMinSize;
        p.inclusionDelay = inclusionDelay;
        p.priorityFeeShare = priorityFeeShare;
        return p;
    }
}

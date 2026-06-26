package io.github.qorechain.rdk.bridge;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.function.Function;

/**
 * Generic binary Merkle tree utilities for assembling withdrawal proofs.
 *
 * <p>An {@code rdk} settlement batch commits its L2→L1 messages (withdrawals) as a binary Merkle
 * root ({@code withdrawals_root}), and {@code MsgExecuteWithdrawal} carries the sibling hashes from
 * a leaf to that root.
 *
 * <p>IMPORTANT: the leaf encoding, hash function, and odd-node handling MUST match the network's
 * {@code withdrawals_root} construction for the proof to verify on-chain. The defaults (SHA-256,
 * hash each leaf, duplicate the last node on odd levels, no domain separation) are a common
 * convention — override {@link MerkleOptions} to match the chain exactly.
 */
public final class Merkle {
    private Merkle() {}

    /** Configures binary Merkle tree construction. Null fields use the documented defaults. */
    public static final class MerkleOptions {
        /** Hash for internal nodes (and leaves when {@code hashLeaves}). Null → SHA-256. */
        public Function<byte[], byte[]> hash;
        /** Hash each input leaf before building the tree. Null → true. */
        public Boolean hashLeaves;
        /** On an odd number of nodes, duplicate the last one. Null → true. */
        public Boolean duplicateOdd;
    }

    private static final class Resolved {
        final Function<byte[], byte[]> hash;
        final boolean hashLeaves;
        final boolean duplicateOdd;

        Resolved(Function<byte[], byte[]> hash, boolean hashLeaves, boolean duplicateOdd) {
            this.hash = hash;
            this.hashLeaves = hashLeaves;
            this.duplicateOdd = duplicateOdd;
        }
    }

    /** The default SHA-256 hash. */
    public static byte[] sha256(byte[] data) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(data);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static Resolved resolve(MerkleOptions options) {
        Function<byte[], byte[]> hash = Merkle::sha256;
        boolean hashLeaves = true;
        boolean duplicateOdd = true;
        if (options != null) {
            if (options.hash != null) {
                hash = options.hash;
            }
            if (options.hashLeaves != null) {
                hashLeaves = options.hashLeaves;
            }
            if (options.duplicateOdd != null) {
                duplicateOdd = options.duplicateOdd;
            }
        }
        return new Resolved(hash, hashLeaves, duplicateOdd);
    }

    private static byte[] concat(byte[] a, byte[] b) {
        byte[] out = new byte[a.length + b.length];
        System.arraycopy(a, 0, out, 0, a.length);
        System.arraycopy(b, 0, out, a.length, b.length);
        return out;
    }

    private static List<byte[]> leafNodes(List<byte[]> leaves, Resolved opts) {
        List<byte[]> out = new ArrayList<>(leaves.size());
        for (byte[] l : leaves) {
            out.add(opts.hashLeaves ? opts.hash.apply(l) : l.clone());
        }
        return out;
    }

    /** Compute the binary Merkle root of a list of leaves. */
    public static byte[] binaryMerkleRoot(List<byte[]> leaves, MerkleOptions options) {
        Resolved opts = resolve(options);
        if (leaves.isEmpty()) {
            return opts.hash.apply(new byte[0]);
        }
        List<byte[]> level = leafNodes(leaves, opts);
        while (level.size() > 1) {
            List<byte[]> next = new ArrayList<>((level.size() + 1) / 2);
            for (int i = 0; i < level.size(); i += 2) {
                byte[] left = level.get(i);
                if (i + 1 < level.size()) {
                    next.add(opts.hash.apply(concat(left, level.get(i + 1))));
                } else if (opts.duplicateOdd) {
                    next.add(opts.hash.apply(concat(left, left)));
                } else {
                    next.add(left);
                }
            }
            level = next;
        }
        return level.get(0);
    }

    /** A leaf's Merkle proof: the sibling hashes from the leaf up to the root. */
    public static final class MerkleProof {
        /** Sibling hashes, leaf level first. */
        public final List<byte[]> siblings;
        /** The computed root. */
        public final byte[] root;
        /** The leaf index the proof is for. */
        public final int index;

        public MerkleProof(List<byte[]> siblings, byte[] root, int index) {
            this.siblings = siblings;
            this.root = root;
            this.index = index;
        }
    }

    /** Build the Merkle proof (sibling path) for the leaf at {@code index}. */
    public static MerkleProof binaryMerkleProof(List<byte[]> leaves, int index, MerkleOptions options) {
        if (index < 0 || index >= leaves.size()) {
            throw new IllegalArgumentException(
                    "leaf index " + index + " out of range (0.." + (leaves.size() - 1) + ")");
        }
        Resolved opts = resolve(options);
        List<byte[]> siblings = new ArrayList<>();
        List<byte[]> level = leafNodes(leaves, opts);
        int idx = index;
        while (level.size() > 1) {
            boolean isRight = idx % 2 == 1;
            int siblingIdx = isRight ? idx - 1 : idx + 1;
            if (siblingIdx < level.size()) {
                siblings.add(level.get(siblingIdx));
            } else if (opts.duplicateOdd) {
                siblings.add(level.get(idx));
            }
            List<byte[]> next = new ArrayList<>((level.size() + 1) / 2);
            for (int i = 0; i < level.size(); i += 2) {
                byte[] left = level.get(i);
                if (i + 1 < level.size()) {
                    next.add(opts.hash.apply(concat(left, level.get(i + 1))));
                } else if (opts.duplicateOdd) {
                    next.add(opts.hash.apply(concat(left, left)));
                } else {
                    next.add(left);
                }
            }
            level = next;
            idx /= 2;
        }
        return new MerkleProof(siblings, level.get(0), index);
    }

    /** Verify a leaf against a Merkle root using a sibling path. */
    public static boolean verifyBinaryMerkleProof(
            byte[] leaf, int index, List<byte[]> siblings, byte[] root, MerkleOptions options) {
        Resolved opts = resolve(options);
        byte[] node = opts.hashLeaves ? opts.hash.apply(leaf) : leaf;
        int idx = index;
        for (byte[] sibling : siblings) {
            node =
                    (idx % 2 == 1)
                            ? opts.hash.apply(concat(sibling, node))
                            : opts.hash.apply(concat(node, sibling));
            idx /= 2;
        }
        return Arrays.equals(node, root);
    }
}

package io.github.qorechain.rdk;

import com.google.gson.Gson;
import io.github.qorechain.rdk.qledger.QledgerEntry;
import io.github.qorechain.rdk.util.Bytes;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** The {@code qledger} section of {@code v328.json}: vectors from the chain's own qledger package. */
final class QledgerFixture {
    String chainId;
    String rollupId;
    String emptyRoot;
    String withdrawalCounterId;
    String recipient;
    List<Acct> accounts;
    List<Entry> entries;
    Txs txs;
    Batch batch;
    Later laterWithdrawals;
    Witnesses witnessesAfterBatch;
    Fraud fraud;

    static final class Acct {
        String id;
        String publicKey;
        String seed;
    }

    static final class Entry {
        long height;
        String poster;
        String payload;
        String note;
        String rootAfter;
    }

    static final class Txs {
        TxVec t1;
        TxVec t2;
    }

    static final class TxVec {
        String unsigned;
        String signingMessage;
        String encoded;
    }

    static final class Batch {
        String accFrom;
        String dataHash;
        long inboxStart;
        long inboxEnd;
        List<List<String>> proofs;
        String stateRoot;
        List<W> withdrawals;
        String withdrawalsRoot;
    }

    static final class W {
        long index;
        String recipient;
        long amount;
        String leaf;
    }

    static final class Later {
        String root;
        List<String> proofOfIndex7;
    }

    static final class Witnesses {
        String root;
        List<Wit> witnesses;
    }

    static final class Wit {
        String id;
        long balance;
        long nonce;
        String bitmap;
        List<String> siblings;
    }

    static final class Fraud {
        String parentRoot;
        String proof;
        String honestStateRoot;
        String honestWithdrawalsRoot;
        String wrongStateRoot;
        String dataHash;
        long inboxStart;
        long inboxEnd;
        int entriesFrom;
    }

    private static final class Root {
        QledgerFixture qledger;
    }

    static QledgerFixture load() {
        try (InputStream in = QledgerFixture.class.getResourceAsStream("/v328.json")) {
            return new Gson().fromJson(new InputStreamReader(in, StandardCharsets.UTF_8), Root.class).qledger;
        } catch (Exception e) {
            throw new RuntimeException("failed to load v328.json", e);
        }
    }

    List<QledgerEntry> qledgerEntries() {
        List<QledgerEntry> out = new ArrayList<>();
        for (Entry e : entries) {
            out.add(new QledgerEntry(e.height, e.poster, Bytes.hexToBytes(e.payload)));
        }
        return out;
    }
}

package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertEquals;

import io.github.qorechain.rdk.util.Denom;
import io.github.qorechain.rdk.util.Economics;
import io.github.qorechain.rdk.util.Economics.CreationCost;
import org.junit.jupiter.api.Test;

class UtilTest {

    @Test
    void denomMatchesGolden() {
        Golden g = Golden.load();
        assertEquals(g.denom.get("qorToUqor_1_5"), Denom.qorToUqor("1.5"));
        assertEquals(g.denom.get("uqorToQor_1e10"), Denom.uqorToQor("10000000000"));
        assertEquals(g.denom.get("qorToUqor_0_000001"), Denom.qorToUqor("0.000001"));
    }

    @Test
    void denomRoundTrips() {
        assertEquals("1500000", Denom.qorToUqor("1.5"));
        assertEquals("1.5", Denom.uqorToQor("1500000"));
        assertEquals("0", Denom.qorToUqor("0"));
        assertEquals("0", Denom.uqorToQor("0"));
    }

    @Test
    void economicsMatchesGolden() {
        Golden g = Golden.load();
        CreationCost cost = Economics.estimateCreationCost(g.economics.get("stakeUqor"), g.economics.get("burnRate"));
        assertEquals(g.economics.get("stakeUqor"), cost.stakeUqor);
        assertEquals(g.economics.get("burnUqor"), cost.burnUqor);
        assertEquals(g.economics.get("netStakeUqor"), cost.netStakeUqor);
        assertEquals(g.economics.get("totalRequiredUqor"), cost.totalRequiredUqor);
        assertEquals(g.economics.get("burnRate"), cost.burnRate);
    }

    @Test
    void burnIsOnePercentOfTenThousandQor() {
        CreationCost cost = Economics.estimateCreationCost("10000000000", null);
        assertEquals("100000000", cost.burnUqor);
        assertEquals("9900000000", cost.netStakeUqor);
    }
}

package io.github.qorechain.rdk;

import io.github.qorechain.rdk.client.Transport;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

/** A {@link Transport} that answers from a routing function, so tests never touch the network. */
final class MockTransport implements Transport {
    final List<Request> requests = new ArrayList<>();
    private final Function<Request, Response> router;

    MockTransport(Function<Request, Response> router) {
        this.router = router;
    }

    @Override
    public Response exchange(Request request) {
        requests.add(request);
        Response r = router.apply(request);
        if (r == null) {
            return new Response(404, "{}");
        }
        return r;
    }
}

package io.github.qorechain.rdk.client;

import io.github.qorechain.rdk.client.Health.HealthOptions;
import io.github.qorechain.rdk.client.Health.RollupHealth;
import io.github.qorechain.rdk.events.Events;
import io.github.qorechain.rdk.events.Events.DecodedRdkEvent;
import io.github.qorechain.rdk.events.Events.EventAttribute;
import io.github.qorechain.rdk.events.Events.RawEvent;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import java.util.function.LongSupplier;

/** Transaction-event reads and a simple rollup-health watch loop. */
public final class Monitor {
    private Monitor() {}

    /**
     * Read a transaction by hash and decode the {@code rdk} events it emitted. Reads
     * {@code tx_response.events} from the REST tx response and runs them through the event decoder.
     */
    public static List<DecodedRdkEvent> eventsFromTxHash(RdkClient client, String hash) {
        Map<String, Object> body = client.rest.getTx(hash);
        Map<String, Object> txResponse = Views.asRecord(Views.pick(body, "tx_response", "txResponse"));
        return Events.decodeRdkEvents(txResponseEvents(txResponse));
    }

    private static List<RawEvent> txResponseEvents(Map<String, Object> txResponse) {
        List<RawEvent> out = new ArrayList<>();
        for (Map<String, Object> ev : Views.asArray(Views.pick(txResponse, "events"))) {
            List<EventAttribute> attrs = new ArrayList<>();
            for (Map<String, Object> attr : Views.asArray(Views.pick(ev, "attributes"))) {
                attrs.add(
                        new EventAttribute(
                                Views.asStr(Views.pick(attr, "key"), ""),
                                Views.asStr(Views.pick(attr, "value"), "")));
            }
            out.add(new RawEvent(Views.asStr(Views.pick(ev, "type"), ""), attrs));
        }
        return out;
    }

    /** Options for {@link #watchRollup}. */
    public static final class WatchOptions {
        /** Poll interval in milliseconds. Zero defaults to 5000. */
        public long intervalMs;
        /** Called with each health snapshot. */
        public Consumer<RollupHealth> onUpdate;
        /** Called on a polling error; the loop continues. */
        public Consumer<RuntimeException> onError;
        /** Overrides the clock (unix seconds), for testing. */
        public LongSupplier nowSecs;
    }

    /** A handle to a running rollup watch. */
    public static final class Watcher {
        private final Thread thread;
        private final AtomicBoolean running;

        Watcher(Thread thread, AtomicBoolean running) {
            this.thread = thread;
            this.running = running;
        }

        /** End the watch and wait for the polling thread to exit. */
        public void stop() {
            running.set(false);
            thread.interrupt();
            try {
                thread.join();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    /**
     * Poll a rollup's health on an interval, invoking {@code onUpdate} each tick. The first poll runs
     * immediately, then on every interval, until {@link Watcher#stop()} is called.
     */
    public static Watcher watchRollup(RdkClient client, String rollupId, WatchOptions options) {
        long interval = options.intervalMs > 0 ? options.intervalMs : 5000;
        AtomicBoolean running = new AtomicBoolean(true);

        Runnable tick =
                () -> {
                    HealthOptions ho = new HealthOptions();
                    if (options.nowSecs != null) {
                        ho.nowSecs = options.nowSecs.getAsLong();
                    }
                    try {
                        RollupHealth health = Health.getRollupHealth(client, rollupId, ho);
                        if (options.onUpdate != null) {
                            options.onUpdate.accept(health);
                        }
                    } catch (RuntimeException e) {
                        if (options.onError != null) {
                            options.onError.accept(e);
                        }
                    }
                };

        Thread thread =
                new Thread(
                        () -> {
                            tick.run();
                            while (running.get()) {
                                try {
                                    Thread.sleep(interval);
                                } catch (InterruptedException e) {
                                    return;
                                }
                                if (!running.get()) {
                                    return;
                                }
                                tick.run();
                            }
                        });
        thread.setDaemon(true);
        thread.start();
        return new Watcher(thread, running);
    }
}

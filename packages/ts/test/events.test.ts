import { describe, it, expect } from "vitest";
import { decodeRdkEvents, findRdkEvent } from "../src/index";

const events = [
  { type: "coin_received", attributes: [{ key: "amount", value: "100uqor" }] },
  {
    type: "rollup_created",
    attributes: [
      { key: "rollup_id", value: "my-rollup" },
      { key: "creator", value: "qor1abc" },
    ],
  },
  { type: "batch_submitted", attributes: [{ key: "batch_index", value: "0" }] },
];

describe("rdk event decoding", () => {
  it("filters to rdk events and maps attributes", () => {
    const decoded = decodeRdkEvents(events);
    expect(decoded.map((e) => e.type)).toEqual(["rollup_created", "batch_submitted"]);
    expect(decoded[0].attributes).toEqual({ rollup_id: "my-rollup", creator: "qor1abc" });
  });

  it("finds a specific event by type", () => {
    expect(findRdkEvent(events, "rollup_created")?.attributes.rollup_id).toBe("my-rollup");
    expect(findRdkEvent(events, "rollup_stopped")).toBeUndefined();
  });
});

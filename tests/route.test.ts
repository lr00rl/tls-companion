// Shared links count workbench steps from 1, matching the "8/25" the transport
// bar shows, while Route.step stays a zero-based index.
import { describe, expect, it } from "vitest";
import { href, parse } from "../src/app/route";

function stepOf(hash: string) {
  const r = parse(hash);
  return r.page === "play" ? r.step : null;
}

describe("malformed links", () => {
  it("keeps a segment with a broken percent escape instead of throwing", () => {
    expect(parse("#/notes/00/%E0%A4%A")).toEqual({ page: "notes", id: "00", anchor: "%E0%A4%A" });
  });
});

describe("play route", () => {
  it("writes the step counted from 1", () => {
    expect(href({ page: "play", scenario: "tls13-full", step: 7 })).toBe("#/play/tls13-full/8");
  });

  it("reads it back as a zero-based index", () => {
    expect(parse("#/play/tls13-full/8")).toEqual({ page: "play", scenario: "tls13-full", step: 7 });
  });

  it("clamps zero, negative, and fractional steps to a valid index", () => {
    expect(stepOf("#/play/tls13-full/0")).toBe(0);
    expect(stepOf("#/play/tls13-full/-3")).toBe(0);
    expect(stepOf("#/play/tls13-full/2.9")).toBe(1);
  });

  it("leaves the step unset when the URL has none or it is not a number", () => {
    expect(stepOf("#/play/tls13-full")).toBeUndefined();
    expect(stepOf("#/play/tls13-full/x")).toBeUndefined();
  });
});

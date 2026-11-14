import { beforeEach, describe, expect, it } from "vitest";
import { _reset, check, GLOBAL_PER_DAY, PER_IP_PER_HOUR } from "./ratelimit";

describe("copilot rate limit", () => {
  beforeEach(_reset);

  it("allows N per visitor per hour, then blocks with a retry time", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < PER_IP_PER_HOUR; i++) expect(check("a", t0 + i).ok).toBe(true);
    const v = check("a", t0 + 100);
    expect(v).toMatchObject({ ok: false, reason: "visitor" });
    expect(v.retryAfterS).toBeGreaterThan(3500);
    expect(check("b", t0 + 100).ok).toBe(true); // other visitors unaffected
    expect(check("a", t0 + 3600_001).ok).toBe(true); // window slides
  });

  it("enforces the global daily cap across visitors", () => {
    const t0 = 5_000_000;
    for (let i = 0; i < GLOBAL_PER_DAY; i++) expect(check(`ip${i}`, t0 + i).ok).toBe(true);
    expect(check("new", t0 + GLOBAL_PER_DAY)).toMatchObject({ ok: false, reason: "global" });
  });
});

import { describe, expect, it } from "vitest";
import { MAX_RESULT_ADDRESSES, resultAddressesSchema } from "@/lib/settings/result-addresses";

const refusal = (value: unknown) => {
  const parsed = resultAddressesSchema.safeParse(value);
  return parsed.success ? null : parsed.error.issues[0]?.message;
};

describe("the addresses a review's result goes to", () => {
  it("keeps each address as typed, less the space around it, the first one first", () => {
    expect(
      resultAddressesSchema.parse(["  lead@example.invalid ", "team@example.invalid"]),
    ).toEqual(["lead@example.invalid", "team@example.invalid"]);
    expect(resultAddressesSchema.parse([])).toEqual([]);
  });

  it("keeps one of two that differ only in case, the first as typed", () => {
    expect(resultAddressesSchema.parse(["Lead@Example.invalid", "lead@example.invalid"])).toEqual([
      "Lead@Example.invalid",
    ]);
  });

  it("refuses what is not one address, in words", () => {
    // A header is built from it one day: a line break or a second address in
    // one line would be a second header, or a second recipient nobody chose.
    expect(refusal(["Lead <lead@example.invalid>"])).toBe(
      'holds "Lead <lead@example.invalid>", which is not one email address: enter the address alone, as name@example.com',
    );
    expect(refusal(["lead@example.invalid, team@example.invalid"])).toBe(
      'holds "lead@example.invalid, team@example.invalid", which is not one email address: enter the address alone, as name@example.com',
    );
    expect(refusal(["lead@example.invalid\nBcc: other@example.invalid"])).toBe(
      "holds a line break or another control character",
    );
    expect(refusal(["lead"])).toBe(
      'holds "lead", which is not one email address: enter the address alone, as name@example.com',
    );
    expect(refusal(["lead@localhost"])).toBe(
      'holds "lead@localhost", which is not one email address: enter the address alone, as name@example.com',
    );
    expect(refusal([""])).toBe("holds an empty line");
    expect(refusal([`${"a".repeat(250)}@example.invalid`])).toBe(
      "holds an address longer than 254",
    );
  });

  it("refuses more addresses than a result is sent to", () => {
    const many = Array.from(
      { length: MAX_RESULT_ADDRESSES + 1 },
      (_, at) => `a${at}@example.invalid`,
    );
    expect(MAX_RESULT_ADDRESSES).toBe(10);
    expect(refusal(many)).toBe("holds more than 10 addresses");
    expect(resultAddressesSchema.parse(many.slice(0, 10))).toHaveLength(10);
  });
});

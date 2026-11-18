/**
 * The emails that count as the person's (WP-L, D-69, D-243).
 */

import { describe, expect, it } from "vitest";
import { MAX_IDENTITIES, identitiesSchema, isMine } from "@/lib/settings/identities";

const refusal = (value: unknown): string | undefined => {
  const parsed = identitiesSchema.safeParse(value);
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
};

describe("the emails kept in Settings", () => {
  it("keeps each email once, as first typed, whatever its case", () => {
    expect(
      identitiesSchema.parse([
        "Me@Example.invalid",
        "  me@example.invalid ",
        "work@example.invalid",
      ]),
    ).toEqual(["Me@Example.invalid", "work@example.invalid"]);
  });

  it("takes none at all, which leaves the choice to git's own config", () => {
    expect(identitiesSchema.parse([])).toEqual([]);
  });

  it("takes an email git would hold though no mail server would", () => {
    // A commit's email is whatever user.email said: GitHub's noreply form, a
    // host with no dot, a name with no @ at all.
    expect(
      identitiesSchema.parse(["1234+me@users.noreply.github.com", "me@laptop", "builder"]),
    ).toEqual(["1234+me@users.noreply.github.com", "me@laptop", "builder"]);
  });

  it("refuses a line left empty", () => {
    expect(refusal(["me@example.invalid", "   "])).toBe("holds an empty line");
  });

  it("refuses a name with its email, which no commit's email can equal", () => {
    expect(refusal(["Me <me@example.invalid>"])).toBe(
      "holds < or >: enter the email alone, without a name",
    );
  });

  it("refuses a control character", () => {
    expect(refusal(["me@example.invalid\u0007"])).toBe("holds a control character");
  });

  it("refuses an email longer than any address", () => {
    expect(refusal([`${"a".repeat(250)}@x.invalid`])).toBe("holds an email longer than 254");
  });

  it("refuses more emails than one person commits as", () => {
    const many = Array.from({ length: MAX_IDENTITIES + 1 }, (_, index) => `me${index}@x.invalid`);
    expect(refusal(many)).toBe(`holds more than ${MAX_IDENTITIES} emails`);
  });

  it("refuses what is not a list of text", () => {
    expect(identitiesSchema.safeParse("me@example.invalid").success).toBe(false);
    expect(identitiesSchema.safeParse([7]).success).toBe(false);
  });
});

describe("whose branch it is", () => {
  it("is mine when its author's email is one of mine, whatever the case", () => {
    expect(isMine("Me@Example.Invalid", ["work@example.invalid", "me@example.invalid"])).toBe(true);
  });

  it("is not mine when the email is another's", () => {
    expect(isMine("colleague@example.invalid", ["me@example.invalid"])).toBe(false);
  });

  it("is not mine when part of the email matches", () => {
    expect(isMine("me@example.invalid.evil", ["me@example.invalid"])).toBe(false);
  });

  it("is nobody's when no email counts as mine", () => {
    expect(isMine("me@example.invalid", [])).toBe(false);
  });

  it("is nobody's when the commit has no email", () => {
    expect(isMine("", ["me@example.invalid"])).toBe(false);
  });
});

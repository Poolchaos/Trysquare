import { z } from "zod";

/**
 * The git emails that count as the person's, kept in Settings (D-69, D-243).
 * A branch is theirs when its newest commit was authored with one of them.
 *
 * Not held to a mail address's shape: a commit's email is whatever
 * `user.email` said that day, GitHub's noreply form and `me@laptop` alike.
 * What is refused is what no commit's email can be: git takes `<`, `>` and
 * line breaks out of one as it writes the commit.
 */
export const MAX_IDENTITIES = 50;

const identitySchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1, "holds an empty line")
      .max(254, "holds an email longer than 254")
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "holds a control character")
      .refine(
        (value) => !/[<>]/.test(value),
        "holds < or >: enter the email alone, without a name",
      ),
  );

export const identitiesSchema = z
  .array(identitySchema)
  .max(MAX_IDENTITIES, `holds more than ${MAX_IDENTITIES} emails`)
  .transform((emails) => {
    const seen = new Set<string>();
    return emails.filter((email) => {
      const key = email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

/**
 * Whether a commit's author is the person. The whole email, whatever its
 * case: hosts and git itself keep the case a person typed, and the same
 * address is typed both ways.
 */
export function isMine(authorEmail: string, identities: readonly string[]): boolean {
  const email = authorEmail.trim().toLowerCase();
  if (email === "") return false;
  return identities.some((identity) => identity.trim().toLowerCase() === email);
}

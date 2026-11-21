import { z } from "zod";

/**
 * The addresses a review's result is to be emailed to, kept in Settings
 * (`docs/plans/EMAIL-REPORT-PLAN.md`, EM-2). The first is the one a review
 * is offered.
 *
 * Held to one address a line, strictly: a message's To header will be built
 * from these, so a name, a second address, a comma or a line break in one is
 * refused here and never reaches a header.
 */
export const MAX_RESULT_ADDRESSES = 10;

/** One address: something, an @, and a domain with a dot in it. None of what a header reads as structure. */
const ONE_ADDRESS = /^[^\s@<>,;:"()[\]\\]+@[^\s@<>,;:"()[\]\\]+\.[^\s@<>,;:"()[\]\\]+$/;

const addressSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1, "holds an empty line")
      .max(254, "holds an address longer than 254")
      .refine(
        (value) => !/[\u0000-\u001f\u007f]/.test(value),
        "holds a line break or another control character",
      )
      .refine((value) => ONE_ADDRESS.test(value), {
        error: (issue) =>
          `holds "${String(issue.input)}", which is not one email address: enter the address alone, as name@example.com`,
      }),
  );

export const resultAddressesSchema = z
  .array(addressSchema)
  .max(MAX_RESULT_ADDRESSES, `holds more than ${MAX_RESULT_ADDRESSES} addresses`)
  .transform((addresses) => {
    const seen = new Set<string>();
    return addresses.filter((address) => {
      const key = address.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

/**
 * Single quotes for the two shells a person here pastes commands into, the
 * one form neither expands inside.
 */

/** A POSIX shell closes the quote, escapes one and opens it again. */
export const posixQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

/**
 * PowerShell doubles a single quote inside single quotes, and ends such a
 * string at the typographic quotes U+2018 to U+201B too, so each is doubled
 * like the ASCII one (an apostrophe in a name such as D'Angelo, typed on a
 * phone, broke a command; each measured on PowerShell 5.1.26100).
 */
export const powershellQuote = (value: string) => `'${value.replace(/['\u2018-\u201b]/g, "$&$&")}'`;

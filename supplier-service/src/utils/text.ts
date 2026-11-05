const REPLACEMENTS: [RegExp, string][] = [
  [/[\u2018\u2019\u201A\u201B\u2032]/g, "'"],
  [/[\u201C\u201D\u201E\u201F\u2033]/g, '"'],
  [/[\u2013\u2014\u2015]/g, '-'],
  [/[\u00A0\u2007\u202F]/g, ' '],
];

/**
 * Folds typographic punctuation (curly quotes, dashes, non-breaking spaces) to ASCII.
 *
 * Seed data and pasted admin input mix `’` and `'`, which breaks search for whatever the
 * keyboard produces. One spelling keeps the catalogue consistent.
 */
export function normalizeText(value: string): string {
  return REPLACEMENTS.reduce((text, [pattern, ascii]) => text.replace(pattern, ascii), value);
}

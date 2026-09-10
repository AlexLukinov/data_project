/** A range text that could not be parsed: which entry, what it said, and what it might have meant. */
export class RangeParseError extends Error {
  constructor(
    /** 1-based position of the failing entry in the comma-separated list. */
    readonly entryIndex: number,
    /** The entry as written (whitespace trimmed). */
    readonly entry: string,
    /** Why it is not valid. */
    readonly reason: string,
    /** A guess at what was meant, when there is a good one. */
    readonly suggestion?: string,
  ) {
    super(
      `Couldn't parse range at entry ${entryIndex}: \`${entry}\` ${reason}.` +
        (suggestion === undefined ? '' : ` Did you mean ${suggestion}?`),
    );
    this.name = 'RangeParseError';
  }
}

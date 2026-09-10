/** A file that could not be imported: what is wrong and, where there is one, what to do instead. */
export class ImportError extends Error {
  constructor(
    message: string,
    /** The file the message is about, when known. */
    readonly file?: string,
  ) {
    super(file === undefined ? message : `${file}: ${message}`);
    this.name = 'ImportError';
  }
}

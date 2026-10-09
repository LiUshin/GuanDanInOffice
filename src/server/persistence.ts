import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function failure(operation: string, filename: string, error?: unknown): Error {
  // JSON parse/stringify errors may contain cards, player names, or other saved
  // data. Surface the operation and filesystem error code, never that payload.
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const suffix = typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : '';
  return new Error(`Unable to ${operation} snapshot "${filename}"${suffix}.`);
}

/**
 * Synchronous, single-process JSON persistence. The caller validates the schema
 * and version after loading; null is reserved for a missing snapshot.
 *
 * A successful save flushes the file before atomically replacing the snapshot.
 * POSIX also flushes the directory entry. Windows does not expose directory
 * fsync through Node, so its rename cannot offer the same power-loss guarantee.
 * Do not point multiple server processes at the same path: there is no locking.
 */
export class SnapshotStore<T> {
  private readonly filename: string;

  constructor(filename: string) {
    if (typeof filename !== 'string' || !filename.trim()) {
      throw new Error('A nonempty snapshot file path is required.');
    }
    this.filename = path.resolve(filename);
  }

  load(): T | null {
    let contents: string;
    try {
      contents = fs.readFileSync(this.filename, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw failure('read', this.filename, error);
    }

    try {
      const value = JSON.parse(contents);
      if (value === null) throw new Error('Null is reserved for a missing snapshot.');
      return value as T;
    } catch {
      throw failure('parse a non-null JSON', this.filename);
    }
  }

  save(value: T): void {
    let contents: string;
    try {
      contents = JSON.stringify(value);
      if (typeof contents !== 'string' || contents === 'null') {
        throw new Error('A non-null JSON value is required.');
      }
    } catch {
      throw failure('serialize a non-null JSON', this.filename);
    }

    const directory = path.dirname(this.filename);
    const temporary = path.join(directory, `.${path.basename(this.filename)}.${process.pid}.${randomUUID()}.tmp`);
    let file: number | undefined;
    let temporaryCreated = false;
    let replaced = false;
    let operation = 'create directory for';
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      operation = 'create temporary file for';
      file = fs.openSync(temporary, 'wx', 0o600);
      temporaryCreated = true;
      operation = 'write';
      fs.writeFileSync(file, `${contents}\n`, 'utf8');
      operation = 'flush';
      fs.fsyncSync(file);
      operation = 'close temporary file for';
      fs.closeSync(file);
      file = undefined;
      operation = 'replace';
      fs.renameSync(temporary, this.filename);
      temporaryCreated = false;
      replaced = true;

      if (process.platform !== 'win32') {
        operation = 'flush directory for';
        const directoryFile = fs.openSync(directory, 'r');
        try {
          fs.fsyncSync(directoryFile);
        } finally {
          fs.closeSync(directoryFile);
        }
      }
    } catch (error) {
      // An error after rename means the complete new snapshot is visible but its
      // directory entry may not survive power loss. Never claim it was rolled back.
      const message = failure(operation, this.filename, error);
      if (replaced) message.message += ' The file was replaced, but durability could not be confirmed.';
      throw message;
    } finally {
      // Cleanup must not hide the original I/O error. Orphaned temporary files
      // remain private and are never considered by load().
      if (file !== undefined) {
        try { fs.closeSync(file); } catch { /* Preserve the original failure. */ }
      }
      if (temporaryCreated) {
        try { fs.unlinkSync(temporary); } catch { /* Preserve the original failure. */ }
      }
    }
  }
}

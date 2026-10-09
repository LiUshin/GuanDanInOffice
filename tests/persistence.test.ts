import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { SnapshotStore } from '../src/server/persistence';

let directory: string;
let filename: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'guandan-persistence-'));
  filename = path.join(directory, 'state.json');
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

test('missing snapshot returns null without creating files', () => {
  assert.equal(new SnapshotStore(filename).load(), null);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('snapshots round-trip through a new store and replace the previous value', () => {
  const value = { version: 1, rooms: [{ id: '办公室', players: ['Alice', 'Bob'], active: true }], round: 2 };
  const store = new SnapshotStore<typeof value>(filename);
  store.save(value);
  assert.deepEqual(new SnapshotStore<typeof value>(filename).load(), value);
  const replacement = { ...value, round: 3, rooms: [] };
  store.save(replacement);
  assert.deepEqual(new SnapshotStore<typeof value>(filename).load(), replacement);
  assert.deepEqual(fs.readdirSync(directory), ['state.json']);
});

test('nested storage directories are created before the first save', () => {
  const nested = path.join(directory, 'state', 'games', 'snapshot.json');
  const store = new SnapshotStore(nested);
  assert.equal(store.load(), null);
  store.save({ version: 1 });
  assert.deepEqual(store.load(), { version: 1 });
});

test('malformed JSON fails without resetting the file or leaking saved contents', () => {
  const malformed = '{"secret-player-name": invalid}';
  fs.writeFileSync(filename, malformed);
  assert.throws(() => new SnapshotStore(filename).load(), error => {
    assert.match((error as Error).message, /Unable to parse.*snapshot/);
    assert.ok(!(error as Error).message.includes('secret-player-name'));
    return true;
  });
  assert.equal(fs.readFileSync(filename, 'utf8'), malformed);
});

test('a literal null snapshot is rejected rather than mistaken for a missing file', () => {
  fs.writeFileSync(filename, 'null');
  assert.throws(() => new SnapshotStore(filename).load(), /Unable to parse/);
  assert.equal(fs.readFileSync(filename, 'utf8'), 'null');
});

test('read errors other than ENOENT are fatal', context => {
  const error = Object.assign(new Error('private data must not appear'), { code: 'EACCES' });
  context.mock.method(fs, 'readFileSync', () => { throw error; });
  assert.throws(() => new SnapshotStore(filename).load(), { message: `Unable to read snapshot "${filename}" (EACCES).` });
});

test('serialization errors leave the previous snapshot intact', () => {
  const store = new SnapshotStore<unknown>(filename);
  store.save({ version: 1 });
  const before = fs.readFileSync(filename, 'utf8');
  const circular: { self?: unknown } = {};
  circular.self = circular;
  for (const value of [circular, undefined, null, BigInt(1)]) {
    assert.throws(() => store.save(value), /Unable to serialize/);
    assert.equal(fs.readFileSync(filename, 'utf8'), before);
    assert.deepEqual(fs.readdirSync(directory), ['state.json']);
  }
});

test('partial write failure preserves the previous snapshot and cleans up its temporary file', context => {
  const store = new SnapshotStore(filename);
  store.save({ round: 1 });
  const before = fs.readFileSync(filename, 'utf8');
  context.mock.method(fs, 'writeFileSync', (file: number) => {
    fs.writeSync(file, '{"partial":');
    throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  });
  assert.throws(() => store.save({ round: 2 }), /Unable to write snapshot.*ENOSPC/);
  assert.equal(fs.readFileSync(filename, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(directory), ['state.json']);
});

test('file fsync failure preserves the previous snapshot and removes the temporary file', context => {
  const store = new SnapshotStore(filename);
  store.save({ round: 1 });
  context.mock.method(fs, 'fsyncSync', () => { throw Object.assign(new Error('I/O failure'), { code: 'EIO' }); });
  assert.throws(() => store.save({ round: 2 }), /Unable to flush snapshot.*EIO/);
  assert.deepEqual(store.load(), { round: 1 });
  assert.deepEqual(fs.readdirSync(directory), ['state.json']);
});

test('rename failure preserves the previous snapshot and removes the temporary file', context => {
  const store = new SnapshotStore(filename);
  store.save({ round: 1 });
  context.mock.method(fs, 'renameSync', () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); });
  assert.throws(() => store.save({ round: 2 }), /Unable to replace snapshot.*EACCES/);
  assert.deepEqual(store.load(), { round: 1 });
  assert.deepEqual(fs.readdirSync(directory), ['state.json']);
});

test('save flushes the complete file before atomic rename and flushes the directory afterward', context => {
  const operations: string[] = [];
  const originalFsync = fs.fsyncSync;
  const originalRename = fs.renameSync;
  context.mock.method(fs, 'fsyncSync', (file: number) => {
    operations.push(fs.fstatSync(file).isDirectory() ? 'directory fsync' : 'file fsync');
    originalFsync(file);
  });
  context.mock.method(fs, 'renameSync', (source: fs.PathLike, target: fs.PathLike) => {
    assert.deepEqual(JSON.parse(fs.readFileSync(source, 'utf8')), { round: 2 });
    assert.equal(path.dirname(String(source)), path.dirname(String(target)));
    operations.push('rename');
    originalRename(source, target);
  });
  new SnapshotStore(filename).save({ round: 2 });
  assert.deepEqual(operations, process.platform === 'win32' ? ['file fsync', 'rename'] : ['file fsync', 'rename', 'directory fsync']);
});

test('directory fsync failure explicitly reports that replacement already happened', { skip: process.platform === 'win32' }, context => {
  const store = new SnapshotStore(filename);
  store.save({ round: 1 });
  const originalFsync = fs.fsyncSync;
  context.mock.method(fs, 'fsyncSync', (file: number) => {
    if (fs.fstatSync(file).isDirectory()) throw Object.assign(new Error('I/O failure'), { code: 'EIO' });
    originalFsync(file);
  });
  assert.throws(() => store.save({ round: 2 }), /file was replaced, but durability could not be confirmed/);
  assert.deepEqual(store.load(), { round: 2 });
  assert.deepEqual(fs.readdirSync(directory), ['state.json']);
});

test('new snapshots and newly created directories are private on POSIX', { skip: process.platform === 'win32' }, () => {
  const nested = path.join(directory, 'private', 'snapshot.json');
  const store = new SnapshotStore(nested);
  store.save({ round: 1 });
  assert.equal(fs.statSync(nested).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(nested)).mode & 0o777, 0o700);
  fs.chmodSync(nested, 0o644);
  store.save({ round: 2 });
  assert.equal(fs.statSync(nested).mode & 0o777, 0o600);
});

test('unusable storage directories fail instead of discarding state', () => {
  fs.writeFileSync(path.join(directory, 'not-a-directory'), 'keep');
  const store = new SnapshotStore(path.join(directory, 'not-a-directory', 'snapshot.json'));
  assert.throws(() => store.save({ version: 1 }), /Unable to create directory/);
  assert.equal(fs.readFileSync(path.join(directory, 'not-a-directory'), 'utf8'), 'keep');
});

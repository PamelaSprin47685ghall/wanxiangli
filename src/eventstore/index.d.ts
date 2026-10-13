export interface AppendResult {
  status: 'Committed' | 'Replayed' | 'Conflict' | 'NotWritten' | 'Unknown';
  revision: number;
  reason: string | null;
}
export interface SqliteConnection {
  exec(sql: string): unknown;
  prepare(sql: string): unknown;
  close(): unknown;
}
export class SqliteJournal {
  constructor(connection: SqliteConnection);
  read(stream: string): string[];
  append(stream: string, expectedRevision: number, requestId: string, body: string): AppendResult;
  close(): void;
}

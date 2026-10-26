export type ResourceKind = 'session' | 'process' | 'tool' | 'job' | 'provider' | 'effect';
export interface Lease {
  readonly registryId: string;
  readonly resourceId: string;
  readonly token: string;
}
export interface Binding {
  readonly externalId: string;
  readonly incarnationId: string;
}
export type Outcome = 'Completed' | 'Failed' | 'Cancelled';
export type Message =
  | { type: 'OpenScope'; scopeId: string; parentId: string | null }
  | { type: 'Reserve'; resourceId: string; scopeId: string; kind: ResourceKind }
  | { type: 'Started'; lease: Lease; binding: Binding }
  | { type: 'Ended'; lease: Lease; binding: Binding; outcome: Outcome }
  | { type: 'NotStarted'; lease: Lease; reason: string }
  | { type: 'Unknown' | 'Cancel'; lease: Lease }
  | { type: 'Drain' | 'Close'; scopeId: string };
export type Decision =
  | { readonly kind: 'ScopeOpened' | 'Draining' | 'Closed'; readonly scopeId: string }
  | { readonly kind: 'Reserved' | 'Started' | 'Ended' | 'NotStarted' | 'Unknown' | 'CancellationRequested' | 'Settled'; readonly lease: Lease };
export type Reply =
  | { readonly status: 'Applied' | 'Replayed'; readonly revision: number; readonly result: Decision; readonly record: string }
  | { readonly status: 'Observed'; readonly revision: number; readonly result: Decision; readonly record: null };
export interface ResourceView {
  readonly lease: Lease;
  readonly scopeId: string;
  readonly kind: ResourceKind;
  readonly phase: 'Reserved' | 'Running' | 'Ended' | 'NotStarted';
  readonly binding: Binding | null;
  readonly outcome: Outcome | null;
  readonly reason: string | null;
  readonly cancellationRequested: boolean;
}
export interface Ownership {
  execute(requestId: string, message: Message): Reply;
  inspect(): {
    readonly registryId: string; readonly revision: number;
    readonly scopes: number; readonly resources: number; readonly unsettled: number;
    readonly roots: readonly string[];
  };
  scope(scopeId: string): {
    readonly scopeId: string; readonly parentId: string | null;
    readonly phase: 'Open' | 'Draining' | 'Closed';
    readonly children: readonly string[]; readonly unsettled: number;
  };
  resource(lease: Lease): ResourceView;
  blockers(scopeId: string): ResourceView[];
  records(): string[];
  head(): { readonly registryId: string; readonly revision: number; readonly digest: string };
}
export const Ownership: { new(registryId: string, records?: readonly string[]): Ownership };

export interface SessionTopologyStore {
  readonly parentsMap: any;
  readonly directoriesMap: any;
  putParent(childId: string, parentId: string): void;
  getParent(childId: string): string | null;
  tryGetParent(childId: string): string | undefined;
  removeParent(childId: string): boolean;
  clearParents(): void;
  putDirectory(sessionId: string, directory: string): void;
  getDirectory(sessionId: string): string | null;
  tryGetDirectory(sessionId: string): string | undefined;
  removeDirectory(sessionId: string): boolean;
  clearDirectories(): void;
  clearSession(sessionId: string): void;
  clearAll(): void;
}
export const SessionTopologyStore: { new(): SessionTopologyStore };
export const sessionTopologyStore: SessionTopologyStore;

export interface SignalBroadcaster {
  subscribe(listener: (signal: any) => any): { dispose(): void };
  snapshot(): readonly ((signal: any) => any)[];
}
export const SignalBroadcaster: { new(): SignalBroadcaster };

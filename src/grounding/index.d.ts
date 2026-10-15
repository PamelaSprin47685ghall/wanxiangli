declare module "wanxiangli/grounding" {
  export interface ScopeRule {
    include: boolean;
    pattern: string;
  }
  export interface PackageDescriptor {
    name: string;
    root: string;
    rules: ScopeRule[];
  }
  export interface GroundingMaterial {
    path: string;
    resultBytes: string;
  }
  export interface GroundingSnapshot {
    workspace: string;
    packageName: string;
    digest: string;
    materials: GroundingMaterial[];
  }
  export function sha256Hex(text: string): string;
  export function matchesPathPattern(pattern: string, path: string): boolean;
  export function canonicalWorkspace(workspace: string): string;
  export function workspaceRelativePath(
    workspace: string,
    path: string
  ): string | undefined;
  export function discover(workspace: string): PackageDescriptor[];
  export function resolve(workspace: string, path: string): string[];
  export function materialize(
    workspace: string,
    packageName: string
  ): GroundingSnapshot;
  export function snapshotsForPaths(
    workspace: string,
    paths: string[]
  ): GroundingSnapshot[];
  export interface GroundingApi {
    sha256Hex(text: string): string;
    matchesPathPattern(pattern: string, path: string): boolean;
    canonicalWorkspace(workspace: string): string;
    workspaceRelativePath(workspace: string, path: string): string | undefined;
    discover(workspace: string): PackageDescriptor[];
    resolve(workspace: string, path: string): string[];
    materialize(workspace: string, packageName: string): GroundingSnapshot;
    snapshotsForPaths(workspace: string, paths: string[]): GroundingSnapshot[];
  }
  export const Grounding: GroundingApi;
}

/// Language names crossing the JS boundary are the external strings
/// "English" and "SimplifiedChinese"; raw labels like "en" / "zh-CN" are
/// accepted wherever a language parameter is declared.
export type LanguageName = 'English' | 'SimplifiedChinese';
export interface PreferenceResolution {
  readonly ok: boolean;
  readonly value: LanguageName | '';
  readonly error: string;
}
export interface Resources {
  resourceExists(relativeResourcePath: string): boolean;
  relativePath(language: string, semanticPath: string): string;
  exists(language: string, semanticPath: string): boolean;
  readText(language: string, semanticPath: string): string;
  render(language: string, semanticPath: string, substitutions: Record<string, string> | null): string;
  renderTemplate(template: string, substitutions: Record<string, string> | null): string;
  tryParseLanguage(raw: string): LanguageName | null;
  parseLanguage(raw: string): LanguageName;
  resolvePreference(
    explicitPreference: string | null,
    hostConfig: string | null,
    vscodeNls: string | null,
    posixLocale: string | null,
    intlLocale: string | null
  ): PreferenceResolution;
  refreshGlobalLanguage(resolve: () => string): void;
  currentGlobalLanguage(): string;
  setHostConfigPreference(raw: string): void;
  clearHostConfigPreference(): void;
  hostConfigPreference(): string | null;
}
export const Resources: {
  new(rootDir?: string): Resources;
  packageRootFrom(startDirectory: string): string;
};

export class ProviderLanguageStore {
  constructor(initialLanguage?: string);
  current(): LanguageName;
  refresh(resolve: () => string): LanguageName;
  setHostConfigPreference(raw: string): void;
  clearHostConfigPreference(): void;
  hostConfigPreference(): string | undefined;
  getHostConfigPreference(): string | null;
  forSessionText(sessionText: string): LanguageName;
  tryParseLanguage(raw: string): LanguageName | null;
  parseLanguage(raw: string): LanguageName;
  resolvePreference(
    explicitPreference: string | null,
    hostConfig: string | null,
    vscodeNls: string | null,
    posixLocale: string | null,
    intlLocale: string | null
  ): PreferenceResolution;
  resolveLadder(
    explicit: string | null,
    hostConfig: string | null,
    vscodeNls: string | null,
    posixLocale: string | null,
    intlLocale: string | null
  ): PreferenceResolution;
  resolveFromObservations(
    explicit: string | null,
    vscodeNls: string | null,
    posixLocale: string | null,
    intlLocale: string | null
  ): PreferenceResolution;
}

export const providerLanguageStore: ProviderLanguageStore;

export class InstalledResourceSlot<T = unknown> {
  constructor(missingErrorMessage: string);
  install(value: T): void;
  tryGet(): T | undefined;
  require(): T;
  isInstalled(): boolean;
  clear(): void;
}

export const runtimeResourcesSlot: InstalledResourceSlot;
export const providerResourcesSlot: InstalledResourceSlot;
export const proseResourcesSlot: InstalledResourceSlot;

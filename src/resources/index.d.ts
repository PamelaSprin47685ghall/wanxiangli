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
  requireLanguagePair(semanticPath: string): void;
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
}
export const Resources: { new(rootDir?: string): Resources };

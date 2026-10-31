export type ResponseTextShape = 'Empty' | 'ToolMarkup' | 'Text'

/**
 * Reports lexical shape using the existing whitespace and tool-tag containment rules.
 * ToolMarkup includes incomplete tags and tags inside otherwise ordinary prose.
 * Does not determine intent, answer quality, XML validity, or whether work is complete.
 */
export declare function classify(text: string | null): ResponseTextShape

/** Canonical JSON stores body first, then carry; original strings and order are preserved. */
export declare function encode(body: readonly string[], carry: readonly string[]): string
/** Reads this field only. Explicit null becomes []; a missing field or invalid value throws. */
export declare function body(encoded: string): string[]
/** Reads this field only. Explicit null becomes []; a missing field or invalid value throws. */
export declare function carry(encoded: string): string[]
/** null means canonical complete encoding; otherwise returns the original protocol error text. */
export declare function validationError(encoded: string): string | null
export declare function entries(encoded: string): { text: string }[]
/** Original body blocks followed by carry blocks, joined with two LF bytes; no rendering. */
export declare function fullText(encoded: string): string

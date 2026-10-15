namespace Wanxiangli.Events

open Fable.Core

/// Canonical JSON identity protocol (§5.0): UTF-8, no BOM, no insignificant whitespace,
/// object keys recursively sorted by Unicode code point, arrays preserve order,
/// sparse array holes encode as null.
module CanonicalJson =

    [<Emit("""
    (function (value) {
        function compareCodePoints(left, right) {
            const leftPoints = Array.from(left, character => character.codePointAt(0));
            const rightPoints = Array.from(right, character => character.codePointAt(0));
            const length = Math.min(leftPoints.length, rightPoints.length);
            for (let index = 0; index < length; index += 1) {
                if (leftPoints[index] !== rightPoints[index]) {
                    return leftPoints[index] - rightPoints[index];
                }
            }
            return leftPoints.length - rightPoints.length;
        }

        function encode(current, arrayElement) {
            if (Array.isArray(current)) {
                return '[' + Array.from(current, item => encode(item, true) ?? 'null').join(',') + ']';
            }

            if (current !== null && typeof current === 'object') {
                const fields = [];
                for (const key of Object.keys(current).sort(compareCodePoints)) {
                    const encoded = encode(current[key], false);
                    if (encoded !== undefined) {
                        fields.push(JSON.stringify(key) + ':' + encoded);
                    }
                }
                return '{' + fields.join(',') + '}';
            }

            const encoded = JSON.stringify(current);
            return encoded === undefined && arrayElement ? 'null' : encoded;
        }

        return encode(value, false);
    })($0)
    """)>]
    let private encode (value: obj) : string = jsNative

    /// Canonical JSON text for any JSON value (no trailing LF).
    let canonicalJson (value: obj) : string = encode value

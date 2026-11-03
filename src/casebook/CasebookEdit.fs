module Wanxiangli.Casebook.CasebookEdit

open Fable.Core
open Fable.Core.JsInterop

type CasebookEdit =
    abstract api: obj
    abstract runtimeBaseClass: string
    abstract commit: unit -> Result<unit, string>

let private runtimeBaseClass =
    """class JsProgram {
  constructor(api) {
    this._api = api;
  }

  _view(source, matches, label) {
    const fail = reason => {
      const err = new Error(reason);
      err.__jsFailure = { code: "PROGRAM_FAILED", reason };
      throw err;
    };

    const anchors = new Map([["^", 0], ["$", source.length]]);
    let cursor = 0;

    const locate = pattern => {
      if (typeof pattern === "string") {
        if (pattern.length === 0) fail(`${label}: anchor strings must be non-empty`);
        const start = source.indexOf(pattern, cursor);
        return start < 0 ? null : { start, end: start + pattern.length };
      }

      if (pattern instanceof RegExp) {
        const flags = [...new Set(pattern.flags.replace(/[gy]/g, "") + "g")].join("");
        const regexp = new RegExp(pattern.source, flags);
        regexp.lastIndex = cursor;
        const match = regexp.exec(source);
        return match ? { start: match.index, end: match.index + match[0].length } : null;
      }

      fail(`${label}: anchor pattern must be a string or RegExp`);
    };

    for (const declaration of matches) {
      if (!Array.isArray(declaration) || declaration.length !== 3)
        fail(`${label}: each anchor declaration must be [begin, end, pattern]`);

      const [begin, end, pattern] = declaration;
      if (!begin || !end || begin === end || begin === "^" || begin === "$" || end === "^" || end === "$")
        fail(`${label}: invalid anchor names`);
      if (anchors.has(begin) || anchors.has(end))
        fail(`${label}: anchor names must be unique`);

      const match = locate(pattern);
      if (!match) fail(`${label}: anchor ${begin}/${end} was not found`);
      anchors.set(begin, match.start);
      anchors.set(end, match.end);
      cursor = match.end;
    }

    const clip = value => Math.min(Math.max(0, value), source.length);
    const offset = name => {
      if (anchors.has(name)) return anchors.get(name);
      const shifted = /^(.*)([+-]\d+)$/.exec(name);
      if (!shifted || shifted[1].length === 0) fail(`${label}: unknown anchor ${name}`);
      return clip(offset(shifted[1]) + Number(shifted[2]));
    };

    return Object.freeze({
      text(from = "^", to = "$") {
        const start = offset(from);
        const end = offset(to);
        if (start > end) fail(`${label}: ${from} is after ${to}`);
        return source.slice(start, end);
      },
    });
  }

  question(matches = []) {
    return this._view(this._api.bookkeeper.question(), matches, "question");
  }

  answer(matches = []) {
    return this._view(this._api.bookkeeper.answer(), matches, "answer");
  }

  setQuestion(newText) {
    const result = this._api.bookkeeper.setQuestion(newText);
    if (result && result.ok === false) {
      const err = new Error(result.reason);
      err.__jsFailure = { code: result.code, reason: result.reason };
      throw err;
    }
  }

  setAnswer(newText) {
    const result = this._api.bookkeeper.setAnswer(newText);
    if (result && result.ok === false) {
      const err = new Error(result.reason);
      err.__jsFailure = { code: result.code, reason: result.reason };
      throw err;
    }
  }

  async run() {
    throw new Error("JS_RUN_NOT_IMPLEMENTED");
  }
}"""

[<Emit("typeof($0)==='string'")>]
let private isString (_value: obj) : bool = jsNative

let internal create
    (question: string)
    (answer: string)
    (renderFailure: string -> string)
    (apply: string option -> string option -> Result<unit, string>)
    : CasebookEdit =
    let mutable questionPatch = None
    let mutable answerPatch = None
    let mutable questionWasSet = false
    let mutable answerWasSet = false

    let failure key =
        createObj [ "ok" ==> false; "code" ==> "PROGRAM_FAILED"; "reason" ==> renderFailure key ]

    let setQuestion (value: obj) : obj =
        if questionWasSet then
            failure "set-question-once"
        elif not (isString value) then
            failure "set-question-string"
        else
            questionWasSet <- true
            questionPatch <- Some(unbox<string> value)
            createObj [ "ok" ==> true ]

    let setAnswer (value: obj) : obj =
        if answerWasSet then
            failure "set-answer-once"
        elif not (isString value) then
            failure "set-answer-string"
        else
            answerWasSet <- true
            answerPatch <- Some(unbox<string> value)
            createObj [ "ok" ==> true ]

    let api =
        createObj
            [ "bookkeeper" ==>
                  createObj
                      [ "question" ==> fun () -> question
                        "answer" ==> fun () -> answer
                        "setQuestion" ==> setQuestion
                        "setAnswer" ==> setAnswer ] ]

    { new CasebookEdit with
        member _.api = api
        member _.runtimeBaseClass = runtimeBaseClass
        member _.commit() = apply questionPatch answerPatch }

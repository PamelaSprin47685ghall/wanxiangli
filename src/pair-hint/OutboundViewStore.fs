module Wanxiangli.PairHint.OutboundViewStore

open System
open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop

[<AttachMembers>]
type OutboundModel =
    { providerID: string
      modelID: string
      variant: obj }

[<AttachMembers>]
type OutboundSnapshot =
    { sessionId: string
      messages: obj
      system: string array
      model: OutboundModel
      toolsCaptured: bool
      nativePayload: obj }

type private PendingState =
    { mutable Messages: obj option
      mutable System: string array option
      mutable Model: OutboundModel option }

type private SessionState =
    { mutable Pending: PendingState
      mutable Sealed: OutboundSnapshot option }

/// 进程内出站请求视图自治存储对象。
/// 管理各会话的待定三元组（messages, system, model）与已封存快照（Sealed），
/// 支持渐进式收集封存、原生请求直封、单次排空与稳定 JSON 序列化。
[<Emit("structuredClone($0)")>]
let private cloneDeep (x: obj) : obj = jsNative

[<Emit("Array.isArray($0)")>]
let private isArray (value: obj) : bool = jsNative

[<Emit("Array.isArray($0) ? Array.from($0) : []")>]
let private copyArray (x: obj) : obj array = jsNative

[<Emit("JSON.stringify($0)")>]
let private stringify (x: obj) : string = jsNative

/// 进程内出站请求视图自治存储对象。
/// 管理各会话的待定三元组（messages, system, model）与已封存快照（Sealed），
/// 支持渐进式收集封存、原生请求直封、单次排空与稳定 JSON 序列化。
[<AttachMembers>]
type OutboundViewStore() =

    let sessions = Dictionary<string, SessionState>()

    let emptyPending () =
        { Messages = None
          System = None
          Model = None }

    let getOrCreateSession (sessionId: string) =
        match sessions.TryGetValue sessionId with
        | true, s -> s
        | false, _ ->
            let s = { Pending = emptyPending (); Sealed = None }
            sessions.[sessionId] <- s
            s

    let trySealSession (sessionId: string) (st: SessionState) =
        match st.Pending.Messages, st.Pending.System, st.Pending.Model with
        | Some msgs, Some sys, Some mdl when
            sys.Length > 0
            && (copyArray msgs).Length > 0
            && not (String.IsNullOrWhiteSpace mdl.providerID)
            && not (String.IsNullOrWhiteSpace mdl.modelID) ->
            let snapshot =
                { sessionId = sessionId
                  messages = msgs
                  system = sys
                  model = mdl
                  toolsCaptured = false
                  nativePayload = null }
            st.Sealed <- Some snapshot
            st.Pending <- emptyPending ()
        | _ -> ()

    let extractSessionIdFromMessages (messages: obj) : string option =
        let arr = copyArray messages
        let first = arr |> Array.tryHead |> Option.defaultValue null
        let sid = if isNull first then null else first?info?sessionID
        let value = if isNull sid then "" else string sid
        if String.IsNullOrWhiteSpace value then None else Some value

    let recordFor (sessionId: string) (content: obj) (update: SessionState -> unit) =
        if not (String.IsNullOrWhiteSpace sessionId) && not (isNull content) then
            update (getOrCreateSession sessionId)

    let systemMessageText (item: obj) : string option =
        let content = if isNull item then null else item?content
        match not (isNull item) && string item?role = "system", content with
        | false, _ | _, null -> None
        | true, value when emitJsExpr value "typeof $0 === 'string'" -> Some(string value)
        | true, value -> Some(stringify value)

    member _.recordMessagesFor(sessionId: string, messages: obj) : unit =
        recordFor sessionId messages (fun st ->
            st.Pending <- if st.Pending.Messages.IsSome then emptyPending () else st.Pending
            st.Pending.Messages <- Some(cloneDeep messages)
            trySealSession sessionId st)

    member this.recordMessages(messages: obj) : unit =
        extractSessionIdFromMessages messages
        |> Option.iter (fun sessionId -> this.recordMessagesFor(sessionId, messages))

    member _.recordSystem(sessionId: string, system: obj) : unit =
        recordFor sessionId system (fun st ->
            st.Pending <- if st.Pending.System.IsSome then emptyPending () else st.Pending
            let rawArr = copyArray system
            let strArr =
                rawArr
                |> Array.choose (fun item ->
                    if isNull item then None
                    else Some(unbox<string> item))
            st.Pending.System <- Some strArr
            trySealSession sessionId st)

    member _.recordModel(sessionId: string, model: obj) : unit =
        recordFor sessionId model (fun st ->
            st.Pending <- if st.Pending.Model.IsSome then emptyPending () else st.Pending
            let providerId =
                if not (isNull model?providerID) then string model?providerID
                elif not (isNull model?provider) then string model?provider
                else ""
            let modelId =
                if not (isNull model?modelID) then string model?modelID
                elif not (isNull model?id) then string model?id
                else ""
            let variant: obj =
                if isNull model?variant then null
                else
                    let v = string model?variant
                    if String.IsNullOrEmpty v then null else box v
            let mdl: OutboundModel =
                { providerID = providerId
                  modelID = modelId
                  variant = variant }
            st.Pending.Model <- Some mdl
            trySealSession sessionId st)

    member _.checkAndSeal(sessionId: string) : bool =
        match sessions.TryGetValue sessionId with
        | true, st ->
            trySealSession sessionId st
            st.Sealed.IsSome
        | false, _ -> false

    member _.recordNativeRequest(sessionId: string, payload: obj, model: obj) : bool =
        let messages: obj = if isNull payload then null else payload?messages
        let tools: obj = if isNull payload then null else payload?tools
        let nativeSystem: obj = if isNull payload then null else payload?system
        let rawMessages = copyArray messages
        let parseSystemItem (item: obj) : string =
            if isNull item then ""
            elif emitJsExpr item "typeof $0 === 'string'" then string item
            else stringify item

        let system =
            if isNull nativeSystem then
                rawMessages |> Array.choose systemMessageText
            elif emitJsExpr nativeSystem "typeof $0 === 'string'" then [| string nativeSystem |]
            else
                copyArray nativeSystem
                |> Array.map parseSystemItem
                |> Array.filter (fun s -> not (String.IsNullOrEmpty s))
        let provider =
            if isNull model then ""
            elif not (isNull model?providerID) then string model?providerID
            elif not (isNull model?provider) then string model?provider
            else ""
        let modelId =
            if isNull model then ""
            elif not (isNull model?modelID) then string model?modelID
            elif not (isNull model?id) then string model?id
            else ""
        let complete =
            not (String.IsNullOrWhiteSpace sessionId)
            && isArray messages && rawMessages.Length > 0
            && isArray tools && system.Length > 0
            && provider <> "" && modelId <> ""
        if complete then
            let state = getOrCreateSession sessionId
            let variant: obj =
                if isNull model?variant then null
                else
                    let v = string model?variant
                    if String.IsNullOrEmpty v then null else box v
            let mdl: OutboundModel =
                { providerID = provider
                  modelID = modelId
                  variant = variant }
            state.Sealed <- Some
                { sessionId = sessionId
                  messages = cloneDeep messages
                  system = system
                  model = mdl
                  toolsCaptured = true
                  nativePayload = cloneDeep payload }
            state.Pending <- emptyPending ()
        complete

    member _.tryGetSealed(sessionId: string) : OutboundSnapshot option =
        match sessions.TryGetValue sessionId with
        | true, s when not (String.IsNullOrWhiteSpace sessionId) -> s.Sealed
        | _ -> None

    member _.discardSealed(sessionId: string) : unit =
        match sessions.TryGetValue sessionId with
        | true, state -> state.Sealed <- None
        | _ -> ()

    member _.clearSession(sessionId: string) : unit =
        if not (String.IsNullOrWhiteSpace sessionId) then
            sessions.Remove sessionId |> ignore

    member _.serializeSnapshot(snapshot: obj) : string =
        if isNull snapshot then "{}"
        else
            let modelObj = createEmpty<obj>
            let mdl = snapshot?model
            modelObj?providerID <- if isNull mdl || isNull mdl?providerID then "" else string mdl?providerID
            modelObj?modelID <- if isNull mdl || isNull mdl?modelID then "" else string mdl?modelID
            modelObj?variant <-
                if isNull mdl || isNull mdl?variant then null
                else box mdl?variant

            let root = createEmpty<obj>
            root?sessionId <- if isNull snapshot?sessionId then "" else string snapshot?sessionId
            root?messages <- snapshot?messages
            root?system <- snapshot?system
            root?model <- modelObj
            root?toolsCaptured <- if isNull snapshot?toolsCaptured then box false else snapshot?toolsCaptured
            root?nativePayload <- if isNull snapshot?nativePayload then null else snapshot?nativePayload

            stringify root

let outboundViewStore = OutboundViewStore()

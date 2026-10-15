namespace Wanxiangli.Events

/// Internal canonical event value. Field names mirror the durable wire fields
/// (event_id, stream_id, event_type, parents, payload, payload_refs, payloads).
type Envelope =
    { EventId: string
      StreamId: string
      EventType: string
      Parents: string list
      Payload: obj
      PayloadRefs: string list
      Payloads: Map<string, byte[]> }

module Envelopes =

    let canonicalSet (values: string list) : string list =
        if List.isEmpty values then [] else values |> List.distinct |> List.sort

    /// Normalize set-shaped fields so identity bytes do not depend on caller order.
    let normalize (envelope: Envelope) : Envelope =
        { envelope with
            Parents = canonicalSet envelope.Parents
            PayloadRefs = canonicalSet envelope.PayloadRefs }

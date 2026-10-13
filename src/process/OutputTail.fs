namespace Wanxiangli.Process

type internal OutputTail(capacity: int) =
    let buffer = Array.zeroCreate<byte> capacity
    let mutable first = 0
    let mutable retained = 0
    let mutable observed = 0.

    let continuation value = value >= 0x80uy && value <= 0xBFuy

    let textView (bytes: byte array) (start: float) finished =
        let mutable left = 0
        if start > 0. then
            while left < bytes.Length && left < 3 && continuation bytes[left] do
                left <- left + 1
        let mutable right = bytes.Length
        if not finished && right > left then
            let mutable lead = right - 1
            while lead > left && continuation bytes[lead] do lead <- lead - 1
            let head = bytes[lead]
            let width =
                if head >= 0xC2uy && head <= 0xDFuy then 2
                elif head >= 0xE0uy && head <= 0xEFuy then 3
                elif head >= 0xF0uy && head <= 0xF4uy then 4
                else 1
            if lead + width > right then right <- lead
        let text =
            try box (Native.decode bytes[left .. right - 1])
            with _ -> null
        text, start + float left, start + float right

    member _.Observed = observed
    member _.Retained = retained

    member _.Append(bytes: byte array) =
        let count = bytes.Length
        observed <- observed + float count
        if capacity > 0 && count > 0 then
            if count >= capacity then
                Native.copyBytes buffer bytes (count - capacity) capacity 0
                first <- 0
                retained <- capacity
            else
                let next = (first + retained) % capacity
                let leading = min count (capacity - next)
                Native.copyBytes buffer bytes 0 leading next
                Native.copyBytes buffer bytes leading (count - leading) 0
                let overflow = max 0 (retained + count - capacity)
                first <- (first + overflow) % capacity
                retained <- min capacity (retained + count)

    member _.Read(after: float, finished: bool): obj =
        Native.integer observed (box after) |> ignore
        let oldest = observed - float retained
        let start = max after oldest
        let count = int (observed - start)
        let bytes = Array.zeroCreate<byte> count
        if count > 0 then
            let offset = (first + int (start - oldest)) % capacity
            let leading = min count (capacity - offset)
            Native.copyBytes bytes buffer offset leading 0
            Native.copyBytes bytes buffer 0 (count - leading) leading
        let text, textFrom, textTo = textView bytes start finished
        Native.objectOf [ "from", box start; "to", box observed; "discarded", box (start - after)
                          "bytes", box bytes; "text", text; "textFrom", box textFrom; "textTo", box textTo ]

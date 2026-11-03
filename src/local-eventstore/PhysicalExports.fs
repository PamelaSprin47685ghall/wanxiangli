module Wanxiangli.LocalEventStore.PhysicalExports

open System.Threading.Tasks

let readLocalStreams (directory: obj) (nowMs: float) : obj =
    Physical.readStreams directory nowMs

let localWriterMetadata (directory: obj) : obj array =
    Physical.writerPhysicalMetadata directory

let localInventory (directory: obj) : string = Physical.inventory directory

let convergeLocalWriter (directory: obj) (writerId: string) (segmentCap: int) : obj =
    Physical.convergeWriterFiles directory writerId segmentCap

let acquireLocalLock (lockTarget: obj) : Task<obj> = Physical.acquire lockTarget

let createLocalWriter (options: obj) : obj = Physical.createWriter options

let appendLocalEvents (writer: obj) (events: obj array) : obj = Physical.append writer events

let localPayloadDigest (bytes: byte array) : string = Physical.digest bytes

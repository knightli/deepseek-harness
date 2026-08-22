import type { Message } from '@deepseek-ai/dsh-llm'
import { snapshotJsonValue } from './json.ts'
import { deriveEventMessage, foldSurface, isSurfaceEligibleType } from './surface.ts'
import {
  SessionHistoryEntryId,
  SessionHistoryInsertError,
} from './types.ts'
import type {
  InsertSessionHistoryGroup,
  InsertSessionHistoryGroupResult,
  SessionEvent,
  SessionHistoryEntry,
  SessionHistoryInsertRecord,
  SessionHistoryMember,
  SessionHistoryReceipt,
  SessionHistorySnapshot,
  SessionHistorySurfaceOp,
  SurfaceOp,
} from './types.ts'

interface FoldedHistory {
  readonly snapshot: SessionHistorySnapshot
  readonly records: ReadonlyMap<SessionHistoryReceipt, SessionHistoryInsertRecord>
  readonly entryIdsByReceipt: ReadonlyMap<SessionHistoryReceipt, readonly SessionHistoryEntryId[]>
}

interface PreparedHistoryInsertion {
  readonly status: InsertSessionHistoryGroupResult['status']
  readonly record: SessionHistoryInsertRecord
  readonly entryIds: readonly SessionHistoryEntryId[]
}

/** Validate the durable capsule envelope before its members can affect history. */
function assertInsertRecordShape(value: unknown): asserts value is SessionHistoryInsertRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SessionHistoryInsertError('HISTORY_CORRUPT', 'session history insertion record is not an object')
  }
  const record = value as Record<string, unknown>
  if (typeof record['receipt'] !== 'string' || record['receipt'].length === 0) {
    throw new SessionHistoryInsertError('HISTORY_CORRUPT', 'session history insertion receipt is invalid')
  }
  if (typeof record['before'] !== 'string' || record['before'].length === 0) {
    throw new SessionHistoryInsertError('HISTORY_CORRUPT', 'session history insertion anchor is invalid')
  }
  if (!Array.isArray(record['members'])) {
    throw new SessionHistoryInsertError('HISTORY_CORRUPT', 'session history insertion members are invalid')
  }
  for (const [index, value] of record['members'].entries()) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new SessionHistoryInsertError('HISTORY_CORRUPT', `session history member ${index} is not an object`)
    }
    const member = value as Record<string, unknown>
    if (typeof member['type'] !== 'string' || member['type'].length === 0 || member['data'] === undefined) {
      throw new SessionHistoryInsertError('HISTORY_CORRUPT', `session history member ${index} has an invalid envelope`)
    }
  }
}

/** Stable logical identity for one ordinary physical event. */
function physicalEntryId(seq: number): SessionHistoryEntryId {
  return SessionHistoryEntryId(JSON.stringify(['physical', seq]))
}

/** Stable logical identity for one member of an atomic insertion record. */
function insertedEntryId(receipt: SessionHistoryReceipt, index: number): SessionHistoryEntryId {
  return SessionHistoryEntryId(JSON.stringify(['insert', receipt, index]))
}

/** Convert a physical surface operation into stable logical identities. */
function physicalSurfaceOp(op: SurfaceOp): SessionHistorySurfaceOp {
  return op === 'append'
    ? 'append'
    : { op: 'replace', start: physicalEntryId(op.start), end: physicalEntryId(op.end) }
}

/** Validate that one insertion is a non-empty sequence of complete closed turns. */
function assertClosedMembers(members: readonly SessionHistoryMember[]): void {
  if (members.length === 0) throw new SessionHistoryInsertError('GROUP_INVALID', 'session history insertion group must not be empty')
  let openTurn: number | undefined
  let openStep: number | undefined
  let completedTurns = 0
  for (const [index, member] of members.entries()) {
    if (!Number.isSafeInteger(member.time)) {
      throw new SessionHistoryInsertError('GROUP_INVALID', `session history member ${index} time must be a safe integer`)
    }
    const memberType: string = member.type
    if (memberType === 'session/history-insert' || memberType === 'session/end-seed') {
      throw new SessionHistoryInsertError('GROUP_INVALID', `session history member ${index} has a forbidden type`)
    }
    if (isSurfaceEligibleType(member.type)) {
      const sources = (member as SessionHistoryMember & { sourceMemberIndexes?: readonly number[] }).sourceMemberIndexes
      if (sources !== undefined) {
        const seen = new Set<number>()
        for (const source of sources) {
          if (!Number.isSafeInteger(source) || source < 0 || source >= index || seen.has(source)) {
            throw new SessionHistoryInsertError('GROUP_INVALID', `session history member ${index} has an invalid source member index`)
          }
          seen.add(source)
        }
      }
    }
    switch (member.type) {
      case 'turn/start':
        if (openTurn !== undefined || openStep !== undefined) {
          throw new SessionHistoryInsertError('GROUP_INVALID', `session history member ${index} opens a nested turn`)
        }
        openTurn = member.data.turn
        break
      case 'step/start':
        if (openTurn !== member.data.turn || openStep !== undefined) {
          throw new SessionHistoryInsertError('GROUP_INVALID', `session history member ${index} opens an invalid step`)
        }
        openStep = member.data.step
        break
      case 'step/end':
        if (openTurn !== member.data.turn || openStep !== member.data.step) {
          throw new SessionHistoryInsertError('GROUP_INVALID', `session history member ${index} closes an invalid step`)
        }
        openStep = undefined
        break
      case 'turn/end':
        if (openTurn !== member.data.turn || openStep !== undefined) {
          throw new SessionHistoryInsertError('GROUP_INVALID', `session history member ${index} closes an invalid turn`)
        }
        openTurn = undefined
        completedTurns++
        break
      default: {
        if (openTurn === undefined) {
          throw new SessionHistoryInsertError('GROUP_INVALID', `session history member ${index} is outside a turn`)
        }
        if (isSurfaceEligibleType(member.type) && openStep === undefined) {
          throw new SessionHistoryInsertError('GROUP_INVALID', `session history member ${index} is outside a step`)
        }
        const location = member.data as { readonly turn?: unknown; readonly step?: unknown }
        if (location.turn !== undefined && location.turn !== openTurn) {
          throw new SessionHistoryInsertError('GROUP_INVALID', `session history member ${index} has an invalid turn`)
        }
        if (location.step !== undefined && location.step !== openStep) {
          throw new SessionHistoryInsertError('GROUP_INVALID', `session history member ${index} has an invalid step`)
        }
        break
      }
    }
  }
  if (openTurn !== undefined || openStep !== undefined || completedTurns === 0) {
    throw new SessionHistoryInsertError('GROUP_INVALID', 'session history insertion group must contain only complete closed turns')
  }
}

/** Build one logical entry for an ordinary physical event. */
function physicalEntry(event: Exclude<SessionEvent, SessionEvent<'session/history-insert'>>): SessionHistoryEntry {
  const shared = {
    id: physicalEntryId(event.seq),
    physicalSeq: event.seq,
    type: event.type,
    time: event.time,
    data: event.data,
    ...(event.ignorable === true ? { ignorable: true as const } : {}),
  }
  if (!isSurfaceEligibleType(event.type)) return Object.freeze(shared) as SessionHistoryEntry
  const surfaceEvent = event as SessionEvent<'user/message' | 'assistant/message' | 'tool/result'>
  if (surfaceEvent.surfaceOp === undefined) return Object.freeze(shared) as SessionHistoryEntry
  return Object.freeze({
    ...shared,
    surfaceOp: physicalSurfaceOp(surfaceEvent.surfaceOp as SurfaceOp),
    ...(surfaceEvent.sourceEventSeqs === undefined
      ? {}
      : { sourceEventIds: Object.freeze(surfaceEvent.sourceEventSeqs.map(physicalEntryId)) }),
  }) as SessionHistoryEntry
}

/** Build the logical entries expanded from one atomic insertion record. */
function insertedEntries(
  record: SessionHistoryInsertRecord,
  physicalSeq?: number,
): readonly SessionHistoryEntry[] {
  const ids = record.members.map((_, index) => insertedEntryId(record.receipt, index))
  return Object.freeze(record.members.map((member, index) => {
    const shared = {
      id: ids[index] as SessionHistoryEntryId,
      ...(physicalSeq === undefined
        ? {}
        : { insertion: Object.freeze({ receipt: record.receipt, memberIndex: index, physicalSeq }) }),
      type: member.type,
      time: member.time,
      data: member.data,
      ...(member.ignorable === true ? { ignorable: true as const } : {}),
    }
    if (!isSurfaceEligibleType(member.type)) return Object.freeze(shared) as SessionHistoryEntry
    const sources = (member as SessionHistoryMember & { sourceMemberIndexes?: readonly number[] }).sourceMemberIndexes
    return Object.freeze({
      ...shared,
      surfaceOp: 'append' as const,
      ...(sources === undefined
        ? {}
        : { sourceEventIds: Object.freeze(sources.map(source => ids[source] as SessionHistoryEntryId)) }),
    }) as SessionHistoryEntry
  }))
}

/** Materialize logical entries back into a contiguous fold input. */
function logicalEvents(entries: readonly SessionHistoryEntry[]): SessionEvent[] {
  const seqById = new Map(entries.map((entry, index) => [entry.id, index] as const))
  const renumberExecution = entries.some(entry => entry.physicalSeq === undefined)
  let logicalTurn = 0
  let logicalStep = 0
  return entries.map((entry, seq) => {
    let data: unknown = entry.data
    if (renumberExecution) {
      switch (entry.type) {
        case 'turn/start':
          logicalTurn += 1
          logicalStep = 0
          data = { ...entry.data, turn: logicalTurn }
          break
        case 'step/start':
          logicalStep += 1
          data = { ...entry.data, turn: logicalTurn, step: logicalStep }
          break
        case 'turn/end':
          data = { ...entry.data, turn: logicalTurn }
          break
        case 'step/end':
        case 'assistant/chunk':
        case 'assistant/message':
        case 'tool/call':
        case 'tool/result':
          data = { ...entry.data, turn: logicalTurn, step: logicalStep }
          break
      }
    }
    const shared = {
      type: entry.type,
      seq,
      time: entry.time,
      data,
      ...(entry.ignorable === true ? { ignorable: true as const } : {}),
    }
    if (!isSurfaceEligibleType(entry.type)) return Object.freeze(shared) as SessionEvent
    const surfaceEntry = entry as SessionHistoryEntry<'user/message' | 'assistant/message' | 'tool/result'>
    if (surfaceEntry.surfaceOp === undefined) return Object.freeze(shared) as SessionEvent
    const surfaceOp: SurfaceOp = surfaceEntry.surfaceOp === 'append'
      ? 'append'
      : {
        op: 'replace',
        start: requiredLogicalSeq(seqById, surfaceEntry.surfaceOp.start),
        end: requiredLogicalSeq(seqById, surfaceEntry.surfaceOp.end),
      }
    return Object.freeze({
      ...shared,
      surfaceOp,
      ...(surfaceEntry.sourceEventIds === undefined
        ? {}
        : { sourceEventSeqs: surfaceEntry.sourceEventIds.map(id => requiredLogicalSeq(seqById, id)) }),
    }) as SessionEvent
  })
}

function requiredLogicalSeq(
  seqById: ReadonlyMap<SessionHistoryEntryId, number>,
  id: SessionHistoryEntryId,
): number {
  const seq = seqById.get(id)
  if (seq === undefined) throw new SessionHistoryInsertError('HISTORY_CORRUPT', 'session logical history references a missing entry')
  return seq
}

/** Canonical logical-history fold over the append-only physical Session log. */
export class HistoryManager {
  private cached: FoldedHistory | undefined

  constructor(private readonly log: readonly SessionEvent[]) {}

  /** Invalidate the cached fold after one committed physical append. */
  invalidate(): void {
    this.cached = undefined
  }

  /** Whether the physical log contains at least one atomic insertion record. */
  get hasInsertions(): boolean {
    return this.log.some(event => event.type === 'session/history-insert')
  }

  /** Current immutable canonical logical history. */
  get snapshot(): SessionHistorySnapshot {
    return this.fold().snapshot
  }

  /** Eagerly validate every physical insertion record and its logical fold. */
  validate(): void {
    this.fold()
  }

  /**
   * Validate and canonicalize one command without mutating the Session.
   * @param command - detached whole-group insertion request.
   * @returns the canonical record and stable logical entry identities.
   */
  prepare(command: InsertSessionHistoryGroup): PreparedHistoryInsertion {
    const snapshot = snapshotJsonValue(command)
    if (snapshot === undefined) {
      throw new SessionHistoryInsertError('GROUP_INVALID', 'session history insertion is not losslessly JSON-serializable')
    }
    const record = snapshot as unknown as SessionHistoryInsertRecord
    assertInsertRecordShape(record)
    const folded = this.fold()
    const existing = folded.records.get(record.receipt)
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(record)) {
        throw new SessionHistoryInsertError('RECEIPT_CONFLICT', 'session history receipt conflicts with an existing insertion')
      }
      return {
        status: 'already-applied',
        record: existing,
        entryIds: folded.entryIdsByReceipt.get(record.receipt) ?? [],
      }
    }
    assertClosedMembers(record.members)
    const anchor = folded.snapshot.entries.find(entry => entry.id === record.before)
    if (anchor === undefined) throw new SessionHistoryInsertError('ANCHOR_NOT_FOUND', 'session history anchor does not exist')
    if (anchor.type !== 'turn/start') {
      throw new SessionHistoryInsertError('PLACEMENT_SPLITS_GROUP', 'session history anchor is not a closed turn boundary')
    }
    const entries = insertedEntries(record)
    return {
      status: 'inserted',
      record,
      entryIds: Object.freeze(entries.map(entry => entry.id)),
    }
  }

  /**
   * Derive model history from the canonical logical order.
   * @returns a fresh array of shared frozen messages.
   */
  deriveMessages(): Message[] {
    const events = logicalEvents(this.fold().snapshot.entries)
    return foldSurface(events).nodes.flatMap((seq) => {
      const event = events[seq]
      if (event === undefined) throw new SessionHistoryInsertError('HISTORY_CORRUPT', 'session logical surface references a missing event')
      const message = deriveEventMessage(event)
      return message === null ? [] : [message]
    })
  }

  private fold(): FoldedHistory {
    if (this.cached !== undefined) return this.cached
    const entries: SessionHistoryEntry[] = []
    const records = new Map<SessionHistoryReceipt, SessionHistoryInsertRecord>()
    const entryIdsByReceipt = new Map<SessionHistoryReceipt, readonly SessionHistoryEntryId[]>()
    for (const event of this.log) {
      if (event.type !== 'session/history-insert') {
        entries.push(physicalEntry(event as Exclude<SessionEvent, SessionEvent<'session/history-insert'>>))
        continue
      }
      const record = event.data
      assertInsertRecordShape(record)
      assertClosedMembers(record.members)
      const previous = records.get(record.receipt)
      if (previous !== undefined) {
        throw new SessionHistoryInsertError('HISTORY_CORRUPT', 'session history contains a duplicate receipt')
      }
      const anchorIndex = entries.findIndex(entry => entry.id === record.before)
      if (anchorIndex < 0) throw new SessionHistoryInsertError('HISTORY_CORRUPT', 'session history contains a missing insertion anchor')
      if (entries[anchorIndex]?.type !== 'turn/start') {
        throw new SessionHistoryInsertError('HISTORY_CORRUPT', 'session history contains an invalid insertion anchor')
      }
      const inserted = insertedEntries(record, event.seq)
      entries.splice(anchorIndex, 0, ...inserted)
      records.set(record.receipt, record)
      entryIdsByReceipt.set(record.receipt, Object.freeze(inserted.map(entry => entry.id)))
    }
    const snapshot = Object.freeze({
      revision: this.log.length,
      entries: Object.freeze([...entries]),
      events: Object.freeze(logicalEvents(entries)),
    })
    this.cached = { snapshot, records, entryIdsByReceipt }
    return this.cached
  }
}

/**
 * Fold a detached physical log into the same canonical history a live Session exposes.
 * @param log - immutable physical Session event log.
 * @returns canonical immutable logical history.
 */
export function materializeSessionHistory(log: readonly SessionEvent[]): SessionHistorySnapshot {
  return new HistoryManager(log).snapshot
}

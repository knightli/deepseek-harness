import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, {
  Session,
  SessionHistoryInsertError,
  SessionHistoryReceipt,
  SessionId,
} from '@deepseek-ai/dsh-session'
import type {
  SessionEvent,
  SessionHistoryMember,
  SessionHistorySnapshot,
} from '@deepseek-ai/dsh-session'

function appendClosedTurn(session: Session, turn: number, text: string): void {
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

function closedTurnMembers(turn: number, text: string): readonly SessionHistoryMember[] {
  return [
    { type: 'turn/start', time: turn * 10, data: { turn } },
    { type: 'step/start', time: turn * 10 + 1, data: { turn, step: 1 } },
    {
      type: 'user/message',
      time: turn * 10 + 2,
      data: createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: 'history-import' },
      }),
    },
    { type: 'step/end', time: turn * 10 + 3, data: { turn, step: 1 } },
    { type: 'turn/end', time: turn * 10 + 4, data: { turn, reason: { kind: 'completed' } } },
  ]
}

function appendClosedStep(session: Session, turn: number, step: number, text: string): void {
  session.append('step/start', { turn, step })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/end', { turn, step })
}

function closedStepMembers(turn: number, step: number, text: string): readonly SessionHistoryMember[] {
  return [
    { type: 'step/start', time: step * 10, data: { turn, step } },
    {
      type: 'user/message',
      time: step * 10 + 1,
      data: createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: 'history-import' },
      }),
    },
    { type: 'step/end', time: step * 10 + 2, data: { turn, step } },
  ]
}

function userTexts(history: SessionHistorySnapshot): string[] {
  return history.entries.flatMap((entry) => {
    if (entry.type !== 'user/message') return []
    return entry.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
  })
}

function derivedTexts(session: Session): string[] {
  return session.deriveMessages().flatMap(message =>
    message.content.flatMap(block => block.type === 'text' ? [block.text] : []),
  )
}

describe('ordered Session history insertion', () => {
  it('inserts one closed step before a stable later step in the same turn', () => {
    const session = Session.create(SessionId('ordered-step-history'))
    session.append('turn/start', { turn: 1 })
    appendClosedStep(session, 1, 1, 'before')
    appendClosedStep(session, 1, 2, 'after')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const anchor = session.history.entries.find(
      entry => entry.type === 'step/start' && entry.data.step === 2,
    )
    expect(anchor).toBeDefined()

    session.insertHistoryGroup({
      receipt: SessionHistoryReceipt('step-growth-1'),
      before: anchor!.id,
      members: closedStepMembers(1, 2, 'inserted'),
    })

    expect(userTexts(session.history)).toEqual(['before', 'inserted', 'after'])
    expect(session.history.events.flatMap(event => event.type === 'step/start'
      ? [event.data.step]
      : [])).toEqual([1, 2, 3])
    const replay = Session.create(
      SessionId('ordered-step-history-replay'),
      structuredClone(session.events),
    )
    expect(userTexts(replay.history)).toEqual(['before', 'inserted', 'after'])
    expect(derivedTexts(replay)).toEqual(['before', 'inserted', 'after'])
  })

  it('rejects a capsule whose complete group kind does not match its anchor', () => {
    const session = Session.create(SessionId('history-group-anchor-kind'))
    session.append('turn/start', { turn: 1 })
    appendClosedStep(session, 1, 1, 'before')
    appendClosedStep(session, 1, 2, 'after')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    appendClosedTurn(session, 2, 'later')
    const stepAnchor = session.history.entries.find(
      entry => entry.type === 'step/start' && entry.data.step === 2,
    )!
    const turnAnchor = session.history.entries.find(
      entry => entry.type === 'turn/start' && entry.data.turn === 2,
    )!

    expect(() => session.insertHistoryGroup({
      receipt: SessionHistoryReceipt('step-at-turn'),
      before: turnAnchor.id,
      members: closedStepMembers(1, 2, 'step'),
    })).toThrow(expect.objectContaining({ code: 'PLACEMENT_SPLITS_GROUP' }))
    expect(() => session.insertHistoryGroup({
      receipt: SessionHistoryReceipt('turn-at-step'),
      before: stepAnchor.id,
      members: closedTurnMembers(3, 'turn'),
    })).toThrow(expect.objectContaining({ code: 'PLACEMENT_SPLITS_GROUP' }))
    expect(() => session.insertHistoryGroup({
      receipt: SessionHistoryReceipt('mixed-group'),
      before: stepAnchor.id,
      members: [...closedStepMembers(1, 2, 'step'), ...closedTurnMembers(3, 'turn')],
    })).toThrow(expect.objectContaining({ code: 'GROUP_INVALID' }))
  })

  it('inserts one closed group before a stable later event and replays the same order', () => {
    const session = Session.create(SessionId('ordered-history'))
    appendClosedTurn(session, 1, 'A')
    appendClosedTurn(session, 2, 'B')

    const anchor = session.history.entries.find(
      entry => entry.type === 'turn/start' && entry.data.turn === 2,
    )
    expect(anchor).toBeDefined()
    const physicalBefore = [...session.events]

    session.insertHistoryGroup({
      receipt: SessionHistoryReceipt('growth-1'),
      before: anchor!.id,
      members: closedTurnMembers(3, 'A-tail'),
    })

    expect(session.events.slice(0, physicalBefore.length)).toEqual(physicalBefore)
    expect(session.events.map(event => event.seq)).toEqual(session.events.map((_, index) => index))
    expect(userTexts(session.history)).toEqual(['A', 'A-tail', 'B'])
    expect(session.history.events.map(event => event.seq))
      .toEqual(session.history.events.map((_, index) => index))
    expect(session.history.events.filter(event => event.type === 'session/history-insert')).toEqual([])
    const inserted = session.history.entries.filter(entry => entry.insertion !== undefined)
    expect(inserted.map(entry => entry.insertion?.memberIndex)).toEqual([0, 1, 2, 3, 4])
    expect(new Set(inserted.map(entry => entry.insertion?.physicalSeq))).toEqual(new Set([6]))
    expect(session.history.events.flatMap(event => event.type === 'turn/start' ? [event.data.turn] : []))
      .toEqual([1, 2, 3])
    expect(session.history.events.flatMap(event => event.type === 'user/message'
      ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : [])).toEqual(['A', 'A-tail', 'B'])
    expect(derivedTexts(session)).toEqual(['A', 'A-tail', 'B'])

    const replay = Session.create(SessionId('ordered-history-replay'), structuredClone(session.events))
    expect(userTexts(replay.history)).toEqual(['A', 'A-tail', 'B'])
    expect(derivedTexts(replay)).toEqual(['A', 'A-tail', 'B'])
  })

  it('fails closed when one receipt is reused for different history', () => {
    const session = Session.create(SessionId('history-receipt-conflict'))
    appendClosedTurn(session, 1, 'A')
    appendClosedTurn(session, 2, 'B')
    const anchor = session.history.entries.find(
      entry => entry.type === 'turn/start' && entry.data.turn === 2,
    )!
    const receipt = SessionHistoryReceipt('growth-conflict')

    session.insertHistoryGroup({
      receipt,
      before: anchor.id,
      members: closedTurnMembers(3, 'first'),
    })
    const committed = session.events

    let thrown: unknown
    try {
      session.insertHistoryGroup({
        receipt,
        before: anchor.id,
        members: closedTurnMembers(3, 'different'),
      })
    } catch (error: unknown) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(SessionHistoryInsertError)
    expect(thrown).toMatchObject({ code: 'RECEIPT_CONFLICT' })
    expect(session.events).toBe(committed)
  })

  it('treats an exact receipt retry as a no-op', () => {
    const session = Session.create(SessionId('history-receipt-retry'))
    appendClosedTurn(session, 1, 'A')
    appendClosedTurn(session, 2, 'B')
    const anchor = session.history.entries.find(
      entry => entry.type === 'turn/start' && entry.data.turn === 2,
    )!
    const command = {
      receipt: SessionHistoryReceipt('growth-retry'),
      before: anchor.id,
      members: closedTurnMembers(3, 'once'),
    }

    const first = session.insertHistoryGroup(command)
    const committed = session.events
    const retried = session.insertHistoryGroup(command)

    expect(first.status).toBe('inserted')
    expect(retried).toEqual({ ...first, status: 'already-applied' })
    expect(session.events).toBe(committed)
    expect(userTexts(session.history)).toEqual(['A', 'once', 'B'])
  })

  it('keeps multiple groups at one anchor in physical commit order', () => {
    const session = Session.create(SessionId('history-same-anchor-order'))
    appendClosedTurn(session, 1, 'A')
    appendClosedTurn(session, 2, 'B')
    const anchor = session.history.entries.find(
      entry => entry.type === 'turn/start' && entry.data.turn === 2,
    )!

    session.insertHistoryGroup({
      receipt: SessionHistoryReceipt('growth-first'),
      before: anchor.id,
      members: closedTurnMembers(3, 'first'),
    })
    session.insertHistoryGroup({
      receipt: SessionHistoryReceipt('growth-second'),
      before: anchor.id,
      members: closedTurnMembers(4, 'second'),
    })

    expect(userTexts(session.history)).toEqual(['A', 'first', 'second', 'B'])
    const replay = Session.create(SessionId('history-same-anchor-order-replay'), structuredClone(session.events))
    expect(userTexts(replay.history)).toEqual(['A', 'first', 'second', 'B'])
  })

  it('rejects the control record through ordinary append at runtime', () => {
    const session = Session.create(SessionId('history-control-reserved'))
    appendClosedTurn(session, 1, 'A')
    appendClosedTurn(session, 2, 'B')
    const anchor = session.history.entries.find(
      entry => entry.type === 'turn/start' && entry.data.turn === 2,
    )!
    const committed = session.events

    expect(() => (session.append as unknown as (
      type: string,
      data: unknown,
    ) => unknown)('session/history-insert', {
      receipt: SessionHistoryReceipt('forged-control'),
      before: anchor.id,
      members: closedTurnMembers(3, 'forged'),
    })).toThrow('reserved for Session.insertHistoryGroup')
    expect(session.events).toBe(committed)
  })

  it('rejects a corrupt persisted capsule before returning a restored Session', () => {
    const session = Session.create(SessionId('history-corrupt-seed-source'))
    appendClosedTurn(session, 1, 'A')
    appendClosedTurn(session, 2, 'B')
    const anchor = session.history.entries.find(
      entry => entry.type === 'turn/start' && entry.data.turn === 2,
    )!
    session.insertHistoryGroup({
      receipt: SessionHistoryReceipt('corrupt-seed'),
      before: anchor.id,
      members: closedTurnMembers(3, 'tail'),
    })
    const seed = structuredClone(session.events) as SessionEvent[]
    const capsule = seed.find(event => event.type === 'session/history-insert')!
    if (capsule.type !== 'session/history-insert') throw new Error('expected capsule')
    const message = capsule.data.members.find(member => member.type === 'user/message')!
    if (message.type !== 'user/message') throw new Error('expected user message')
    ;(message.data as { id: string }).id = ''

    expect(() => Session.create(SessionId('history-corrupt-seed-target'), seed))
      .toThrow(/session\/history-insert.*lacks an identified message/)
  })

  it('rejects a persisted capsule whose anchor is absent', () => {
    const session = Session.create(SessionId('history-missing-anchor-source'))
    appendClosedTurn(session, 1, 'A')
    appendClosedTurn(session, 2, 'B')
    const anchor = session.history.entries.find(
      entry => entry.type === 'turn/start' && entry.data.turn === 2,
    )!
    session.insertHistoryGroup({
      receipt: SessionHistoryReceipt('missing-anchor'),
      before: anchor.id,
      members: closedTurnMembers(3, 'tail'),
    })
    const seed = structuredClone(session.events) as SessionEvent[]
    const capsule = seed.find(event => event.type === 'session/history-insert')!
    if (capsule.type !== 'session/history-insert') throw new Error('expected capsule')
    ;(capsule.data as { before: string }).before = '["physical",999999]'

    expect(() => Session.create(SessionId('history-missing-anchor-target'), seed))
      .toThrow(/missing insertion anchor/)
  })

  it('rejects insertion after the Session has been published live', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('history-live-rejected'))
    appendClosedTurn(session, 1, 'A')
    appendClosedTurn(session, 2, 'B')
    const anchor = session.history.entries.find(
      entry => entry.type === 'turn/start' && entry.data.turn === 2,
    )!
    const committed = session.events

    expect(() => session.insertHistoryGroup({
      receipt: SessionHistoryReceipt('live-rejected'),
      before: anchor.id,
      members: closedTurnMembers(3, 'tail'),
    })).toThrow(expect.objectContaining({ code: 'LIVE_SESSION_UNSUPPORTED' }))
    expect(session.events).toBe(committed)
  })

  it('rejects members outside their complete turn and step state', () => {
    const session = Session.create(SessionId('history-state-machine'))
    appendClosedTurn(session, 1, 'A')
    appendClosedTurn(session, 2, 'B')
    const anchor = session.history.entries.find(
      entry => entry.type === 'turn/start' && entry.data.turn === 2,
    )!
    const user = closedTurnMembers(3, 'outside')[2]!

    expect(() => session.insertHistoryGroup({
      receipt: SessionHistoryReceipt('outside-turn'),
      before: anchor.id,
      members: [user, ...closedTurnMembers(3, 'inside')],
    })).toThrow(expect.objectContaining({ code: 'GROUP_INVALID' }))
    expect(() => session.insertHistoryGroup({
      receipt: SessionHistoryReceipt('outside-step'),
      before: anchor.id,
      members: [
        { type: 'turn/start', time: 30, data: { turn: 3 } },
        user,
        { type: 'turn/end', time: 32, data: { turn: 3, reason: { kind: 'completed' } } },
      ],
    })).toThrow(expect.objectContaining({ code: 'GROUP_INVALID' }))
  })
})

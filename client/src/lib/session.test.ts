import { describe, expect, it } from 'vitest'

import { joinPayload, rejoinAction, shouldAcceptState, type JoinIntent } from './session'

const intent: JoinIntent = { code: 'K7XQM', name: 'Alice', playerId: 'pA' }

describe('joinPayload', () => {
  it('sends a code join for a code target', () => {
    expect(joinPayload({ kind: 'code', value: 'K7XQM' }, 'Alice', 'pA')).toEqual({
      code: 'K7XQM',
      name: 'Alice',
      playerId: 'pA'
    })
  })

  it('sends a name join for a name target', () => {
    expect(joinPayload({ kind: 'name', value: 'team-alpha' }, 'Alice', 'pA')).toEqual({
      roomName: 'team-alpha',
      name: 'Alice',
      playerId: 'pA'
    })
  })
})

describe('shouldAcceptState', () => {
  it('drops every broadcast while we intend to be in no room', () => {
    // The race this guards: a pre-Leave broadcast landing after we left, which
    // would otherwise resurrect the room view and pin the address bar to it.
    expect(shouldAcceptState({ code: 'K7XQM' }, null)).toBe(false)
  })

  it('accepts only the room we intend to be in', () => {
    expect(shouldAcceptState({ code: 'K7XQM' }, intent)).toBe(true)
    expect(shouldAcceptState({ code: 'AAAAA' }, intent)).toBe(false)
  })
})

describe('rejoinAction', () => {
  it('rejoins the intended room when the connection is fresh', () => {
    expect(
      rejoinAction(intent, { boundOnThisSocket: false, awaitingAck: false })
    ).toBe(intent)
  })

  it('stays put without an intent, on a bound connection, or mid-join', () => {
    expect(rejoinAction(null, { boundOnThisSocket: false, awaitingAck: false })).toBeNull()
    expect(rejoinAction(intent, { boundOnThisSocket: true, awaitingAck: false })).toBeNull()
    expect(rejoinAction(intent, { boundOnThisSocket: false, awaitingAck: true })).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'

import { looksLikeRoomCode } from '@shared/naming'

import {
  canonicalRoomPath,
  roomTargetFromPath,
  roomUrl,
  targetMatchesRoom
} from './share'

describe('looksLikeRoomCode', () => {
  it('accepts 3–5 chars from the no-lookalike alphabet, case-insensitively', () => {
    expect(looksLikeRoomCode('ABCDE')).toBe(true)
    expect(looksLikeRoomCode('k7xqm')).toBe(true)
    expect(looksLikeRoomCode('AB2')).toBe(true)
  })

  it('rejects other shapes', () => {
    expect(looksLikeRoomCode('AB')).toBe(false)
    expect(looksLikeRoomCode('ABCDEF')).toBe(false)
    expect(looksLikeRoomCode('A0O1I')).toBe(false) // lookalikes excluded from the alphabet
    expect(looksLikeRoomCode('team-alpha')).toBe(false)
    expect(looksLikeRoomCode('te am')).toBe(false)
  })
})

describe('roomTargetFromPath', () => {
  it('returns null for the lobby path', () => {
    expect(roomTargetFromPath('/')).toBeNull()
    expect(roomTargetFromPath('')).toBeNull()
    expect(roomTargetFromPath('///')).toBeNull()
    expect(roomTargetFromPath('/%20%20')).toBeNull()
  })

  it('reads a room name from the first segment', () => {
    expect(roomTargetFromPath('/team-alpha')).toEqual({ kind: 'name', value: 'team-alpha' })
    expect(roomTargetFromPath('/Team-Alpha')).toEqual({ kind: 'name', value: 'Team-Alpha' })
    expect(roomTargetFromPath('/Sprint%20Planning')).toEqual({ kind: 'name', value: 'Sprint Planning' })
    expect(roomTargetFromPath('/%E2%9C%93')).toEqual({ kind: 'name', value: '✓' })
    expect(roomTargetFromPath('/team-alpha/extra')).toEqual({ kind: 'name', value: 'team-alpha' })
  })

  it('reads an encoded slash inside the segment', () => {
    expect(roomTargetFromPath('/a%2Fb')).toEqual({ kind: 'name', value: 'a/b' })
  })

  it('prefers the code interpretation for code-shaped segments', () => {
    expect(roomTargetFromPath('/K7XQM')).toEqual({ kind: 'code', value: 'K7XQM' })
    expect(roomTargetFromPath('/k7xqm')).toEqual({ kind: 'code', value: 'K7XQM' })
    expect(roomTargetFromPath('/beta')).toEqual({ kind: 'code', value: 'BETA' })
  })

  it('rejects malformed encodings and over-long names', () => {
    expect(roomTargetFromPath('/%zz')).toBeNull()
    expect(roomTargetFromPath(`/${'x'.repeat(41)}`)).toBeNull()
    expect(roomTargetFromPath(`/${'x'.repeat(40)}`)).toEqual({ kind: 'name', value: 'x'.repeat(40) })
  })
})

describe('canonicalRoomPath', () => {
  it('uses the name when present, else the code', () => {
    expect(canonicalRoomPath({ code: 'K7XQM', name: null })).toBe('/K7XQM')
    expect(canonicalRoomPath({ code: 'K7XQM', name: 'team-alpha' })).toBe('/team-alpha')
  })

  it('percent-encodes legacy names that predate the slug rules', () => {
    expect(canonicalRoomPath({ code: 'K7XQM', name: 'Team Alpha' })).toBe('/Team%20Alpha')
  })
})

describe('roomUrl', () => {
  it('builds a shareable URL on the given origin', () => {
    expect(roomUrl('team-alpha', 'https://poker.example')).toBe('https://poker.example/team-alpha')
    expect(roomUrl('K7XQM', 'https://poker.example')).toBe('https://poker.example/K7XQM')
    expect(roomUrl('Team Alpha', 'https://poker.example')).toBe('https://poker.example/Team%20Alpha')
  })
})

describe('targetMatchesRoom', () => {
  it('matches codes case-insensitively', () => {
    const room = { code: 'K7XQM', name: null }
    expect(targetMatchesRoom({ kind: 'code', value: 'K7XQM' }, room)).toBe(true)
    expect(targetMatchesRoom({ kind: 'code', value: 'k7xqm' }, room)).toBe(true)
    expect(targetMatchesRoom({ kind: 'code', value: 'ABCDE' }, room)).toBe(false)
  })

  it('matches names via the slug key (legacy spaced names included)', () => {
    expect(targetMatchesRoom({ kind: 'name', value: 'team-alpha' }, { code: 'K7XQM', name: 'team-alpha' })).toBe(true)
    expect(targetMatchesRoom({ kind: 'name', value: 'team-alpha' }, { code: 'K7XQM', name: 'Team Alpha' })).toBe(true)
    expect(targetMatchesRoom({ kind: 'name', value: 'other-room' }, { code: 'K7XQM', name: 'team-alpha' })).toBe(false)
    expect(targetMatchesRoom({ kind: 'name', value: 'team-alpha' }, { code: 'K7XQM', name: null })).toBe(false)
  })
})

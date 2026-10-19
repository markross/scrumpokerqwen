import { MAX_ROOM_NAME_LENGTH } from '@shared/naming'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function joinCodeFromUrl(search = window.location.search): string {
  const raw = (new URLSearchParams(search).get('join') ?? '').trim().toUpperCase()
  if (raw.length < 3 || raw.length > 5) return ''
  return [...raw].every((ch) => CODE_ALPHABET.includes(ch)) ? raw : ''
}

export function roomNameFromUrl(search = window.location.search): string {
  const raw = (new URLSearchParams(search).get('room') ?? '').trim()
  return raw.length >= 1 && raw.length <= MAX_ROOM_NAME_LENGTH ? raw : ''
}

export function shareLinkForCode(code: string, href = window.location.href): string {
  const url = new URL(href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('join', code)
  return url.toString()
}

export function shareLinkForName(name: string, href = window.location.href): string {
  const url = new URL(href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('room', name)
  return url.toString()
}

export function clearJoinParam(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('join')
  url.searchParams.delete('room')
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
}

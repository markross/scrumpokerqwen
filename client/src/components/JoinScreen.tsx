import { useState, type FormEvent, type ReactElement } from 'react'
import { Loader2, Spade } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { ThemeToggle } from '@/components/ThemeToggle'
import { clearJoinParam, joinCodeFromUrl, roomNameFromUrl } from '@/lib/share'
import { readStoredName } from '@/useRoom'

interface JoinScreenProps {
  onCreate: (name: string, roomName?: string) => void
  onJoin: (code: string, name: string) => void
  onJoinByName: (roomName: string, name: string) => void
  error: string | null
  busy: boolean
}

export function JoinScreen({ onCreate, onJoin, onJoinByName, error, busy }: JoinScreenProps): ReactElement {
  const [name, setName] = useState(readStoredName)
  const [joinMode, setJoinMode] = useState<'code' | 'name'>(() =>
    joinCodeFromUrl() || !roomNameFromUrl() ? 'code' : 'name'
  )
  const [code, setCode] = useState(joinCodeFromUrl)
  const [roomName, setRoomName] = useState(() => (joinCodeFromUrl() ? '' : roomNameFromUrl()))
  const [newRoomName, setNewRoomName] = useState('')

  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && !busy

  function handleCreate(e: FormEvent): void {
    e.preventDefault()
    if (!canSubmit) return
    const requested = newRoomName.trim()
    onCreate(trimmed, requested.length > 0 ? requested : undefined)
  }

  function handleJoin(e: FormEvent): void {
    e.preventDefault()
    if (!canSubmit) return
    if (joinMode === 'code') {
      if (code.trim().length < 3) return
      clearJoinParam()
      onJoin(code.trim().toUpperCase(), trimmed)
    } else {
      if (roomName.trim().length < 1) return
      clearJoinParam()
      onJoinByName(roomName.trim(), trimmed)
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Badge variant="secondary" className="mb-2 size-12 rounded-xl p-0 [&_svg]:size-6">
            <Spade />
          </Badge>
          <CardTitle className="text-2xl">Scrum Poker</CardTitle>
          <CardDescription>Enter your name to join the estimation.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={handleCreate} className="flex flex-col gap-3">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              maxLength={24}
              autoFocus
              aria-label="Your name"
            />
            <Input
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              placeholder="Room name (optional)"
              maxLength={40}
              aria-label="Room name (optional)"
            />
            <Button type="submit" size="lg" disabled={!canSubmit}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              Create room
            </Button>
          </form>
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-muted-foreground text-xs uppercase tracking-wide">or join</span>
            <Separator className="flex-1" />
          </div>
          <form onSubmit={handleJoin} className="flex flex-col gap-2">
            <div className="flex gap-1" role="group" aria-label="Join mode">
              <Button
                type="button"
                size="sm"
                variant={joinMode === 'code' ? 'secondary' : 'ghost'}
                aria-pressed={joinMode === 'code'}
                className="flex-1 text-xs"
                onClick={() => setJoinMode('code')}
              >
                By code
              </Button>
              <Button
                type="button"
                size="sm"
                variant={joinMode === 'name' ? 'secondary' : 'ghost'}
                aria-pressed={joinMode === 'name'}
                className="flex-1 text-xs"
                onClick={() => setJoinMode('name')}
              >
                By name
              </Button>
            </div>
            <div className="flex gap-2">
              {joinMode === 'code' ? (
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="CODE"
                  maxLength={5}
                  className="font-mono tracking-[0.3em] uppercase"
                  aria-label="Room code"
                />
              ) : (
                <Input
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder="Room name"
                  maxLength={40}
                  aria-label="Room name"
                />
              )}
              <Button
                type="submit"
                variant="secondary"
                size="default"
                disabled={
                  !canSubmit ||
                  (joinMode === 'code' ? code.trim().length < 3 : roomName.trim().length < 1)
                }
              >
                Join
              </Button>
            </div>
          </form>
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  )
}

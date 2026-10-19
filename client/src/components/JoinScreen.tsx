import { useState, type FormEvent, type ReactElement } from 'react'
import { Loader2, Spade } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { readStoredName } from '@/useRoom'

interface JoinScreenProps {
  onCreate: (name: string) => void
  onJoin: (code: string, name: string) => void
  error: string | null
  busy: boolean
}

export function JoinScreen({ onCreate, onJoin, error, busy }: JoinScreenProps): ReactElement {
  const [name, setName] = useState(readStoredName)
  const [code, setCode] = useState('')

  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && !busy

  function handleCreate(e: FormEvent): void {
    e.preventDefault()
    if (canSubmit) onCreate(trimmed)
  }

  function handleJoin(e: FormEvent): void {
    e.preventDefault()
    if (canSubmit && code.trim().length >= 3) onJoin(code.trim().toUpperCase(), trimmed)
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
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
          <form onSubmit={handleJoin} className="flex gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="CODE"
              maxLength={5}
              className="font-mono tracking-[0.3em] uppercase"
              aria-label="Room code"
            />
            <Button type="submit" variant="secondary" size="default" disabled={!canSubmit || code.trim().length < 3}>
              Join
            </Button>
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

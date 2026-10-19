import { useState, type ReactElement } from 'react'
import { Check, Copy, Eye, Link2, LogOut, RotateCcw, Spade, WifiOff } from 'lucide-react'
import type { DeckValue, RoomState } from '@shared/types'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { shareLinkForCode } from '@/lib/share'
import { PlayerCard } from '@/components/PlayerCard'
import { SummaryBar } from '@/components/SummaryBar'
import { ThemeToggle } from '@/components/ThemeToggle'
import { VoteDeck } from '@/components/VoteDeck'

interface RoomProps {
  state: RoomState
  meId: string
  connected: boolean
  onVote: (value: DeckValue) => void
  onReveal: () => void
  onReset: () => void
  onLeave: () => void
}

export function Room({ state, meId, connected, onVote, onReveal, onReset, onLeave }: RoomProps): ReactElement {
  const [copied, setCopied] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const revealed = state.phase === 'revealed'
  const me = state.players.find((p) => p.id === meId)
  const allVoted = state.total > 0 && state.votedCount === state.total

  function copyCode(): void {
    void navigator.clipboard.writeText(state.code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  function copyLink(): void {
    void navigator.clipboard.writeText(shareLinkForCode(state.code)).then(() => {
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 1500)
    })
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-4 pb-8">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Spade className="text-primary size-5" />
          <h1 className="text-lg font-semibold">Scrum Poker</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="font-mono text-sm tracking-[0.2em]">
            {state.code}
          </Badge>
          <Button variant="ghost" size="icon" className="size-8" onClick={copyCode} aria-label="Copy room code">
            {copied ? <Check className="text-success" /> : <Copy />}
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={copyLink} aria-label="Copy invite link">
            {copiedLink ? <Check className="text-success" /> : <Link2 />}
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          {!connected ? (
            <Badge variant="warning">
              <WifiOff />
              Reconnecting…
            </Badge>
          ) : null}
          <Badge variant={allVoted && !revealed ? 'success' : 'secondary'}>
            {state.votedCount}/{state.total} voted
          </Badge>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Leave room">
                <LogOut />
                Leave
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Leave this room?</DialogTitle>
                <DialogDescription>
                  Your vote will be removed and you&apos;ll return to the name screen.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Stay</Button>
                </DialogClose>
                <Button variant="destructive" onClick={onLeave}>
                  Leave
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <section aria-label="Players">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {state.players.map((player) => (
            <PlayerCard key={player.id} player={player} isMe={player.id === meId} revealed={revealed} />
          ))}
        </div>
      </section>

      {revealed ? (
        <div className="flex flex-col gap-3">
          <SummaryBar players={state.players} />
          <p className="text-muted-foreground text-center text-sm">
            Votes are in. Talk through the spread, then start the next round.
          </p>
        </div>
      ) : (
        <section className="flex flex-col gap-3" aria-label="Your estimate">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium">Your estimate</h2>
            <span className="text-muted-foreground text-xs">Tap again to change until votes are revealed</span>
          </div>
          <VoteDeck selected={me?.vote ?? null} disabled={revealed} onSelect={onVote} />
        </section>
      )}

      <footer className="mt-auto flex justify-center gap-3 pt-2">
        <Button variant="outline" size="lg" onClick={onReset}>
          <RotateCcw />
          Reset
        </Button>
        <Button size="lg" onClick={onReveal} disabled={revealed}>
          <Eye />
          Reveal votes
        </Button>
      </footer>
    </main>
  )
}

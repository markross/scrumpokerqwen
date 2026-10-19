import type { ReactElement } from 'react'
import { Check } from 'lucide-react'
import type { PlayerView } from '@shared/types'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface PlayerCardProps {
  player: PlayerView
  isMe: boolean
  revealed: boolean
}

export function PlayerCard({ player, isMe, revealed }: PlayerCardProps): ReactElement {
  return (
    <div className="relative aspect-[5/4] [perspective:900px]">
      <div
        className={cn(
          'relative h-full w-full transition-transform duration-500 [transform-style:preserve-3d]',
          revealed && '[transform:rotateY(180deg)]'
        )}
      >
        <Card
          className={cn(
            'absolute inset-0 flex flex-col justify-between p-3 [backface-visibility:hidden]',
            !player.connected && 'opacity-50'
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="truncate text-sm font-semibold">{player.name}</span>
            {isMe ? <Badge variant="secondary" className="shrink-0">You</Badge> : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-1">
            {player.hasVoted ? (
              <Badge variant="success">
                <Check />
                Voted
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                Waiting
              </Badge>
            )}
            {!player.connected ? (
              <Badge variant="secondary" className="text-muted-foreground">
                Offline
              </Badge>
            ) : null}
          </div>
        </Card>
        <Card className="absolute inset-0 flex items-center justify-center border-primary/40 bg-primary/10 [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <span
            className={cn(
              'text-5xl font-bold tabular-nums',
              player.vote === '?' && 'text-warning',
              player.vote === '∞' && 'text-destructive'
            )}
          >
            {player.vote ?? '–'}
          </span>
        </Card>
      </div>
    </div>
  )
}

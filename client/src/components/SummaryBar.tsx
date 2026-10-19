import type { ReactElement } from 'react'
import type { DeckValue, PlayerView } from '@shared/types'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

interface Summary {
  modes: number[]
  min: number | null
  max: number | null
  questionCount: number
  infinityCount: number
}

export function summarize(votes: DeckValue[]): Summary {
  const numeric = votes.filter((v) => v !== '?' && v !== '∞').map(Number)
  const questionCount = votes.filter((v) => v === '?').length
  const infinityCount = votes.filter((v) => v === '∞').length
  if (numeric.length === 0) {
    return { modes: [], min: null, max: null, questionCount, infinityCount }
  }
  const counts = new Map<number, number>()
  for (const n of numeric) counts.set(n, (counts.get(n) ?? 0) + 1)
  let peak = 0
  for (const count of counts.values()) peak = Math.max(peak, count)
  const modes = [...counts.entries()]
    .filter(([, count]) => count === peak)
    .map(([value]) => value)
    .sort((a, b) => a - b)
  return { modes, min: Math.min(...numeric), max: Math.max(...numeric), questionCount, infinityCount }
}

interface SummaryBarProps {
  players: PlayerView[]
}

export function SummaryBar({ players }: SummaryBarProps): ReactElement {
  const votes = players.map((p) => p.vote).filter((v): v is DeckValue => v !== null)
  const summary = summarize(votes)
  const range =
    summary.min === null || summary.max === null
      ? null
      : summary.min === summary.max
        ? String(summary.min)
        : `${summary.min}–${summary.max}`

  return (
    <Card className="flex flex-wrap items-center gap-x-8 gap-y-3 p-4">
      <div className="flex items-baseline gap-3">
        <span className="text-muted-foreground text-xs uppercase tracking-wide">Consensus</span>
        <span className="text-primary text-3xl font-bold tabular-nums">
          {summary.modes.length > 0 ? summary.modes.join(' / ') : '—'}
        </span>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-muted-foreground text-xs uppercase tracking-wide">Range</span>
        <span className="text-xl font-semibold tabular-nums">{range ?? '—'}</span>
      </div>
      <div className="flex items-center gap-2">
        {summary.questionCount > 0 ? <Badge variant="warning">? × {summary.questionCount}</Badge> : null}
        {summary.infinityCount > 0 ? <Badge variant="destructive">∞ × {summary.infinityCount}</Badge> : null}
      </div>
    </Card>
  )
}

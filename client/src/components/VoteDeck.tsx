import type { ReactElement } from 'react'
import { DECK_VALUES, type DeckValue } from '@shared/types'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface VoteDeckProps {
  selected: DeckValue | null
  disabled: boolean
  onSelect: (value: DeckValue) => void
}

export function VoteDeck({ selected, disabled, onSelect }: VoteDeckProps): ReactElement {
  return (
    <div className="grid grid-cols-5 gap-2 sm:gap-3" role="group" aria-label="Estimate deck">
      {DECK_VALUES.map((value) => (
        <Button
          key={value}
          type="button"
          variant={selected === value ? 'default' : 'outline'}
          size="lg"
          disabled={disabled}
          aria-pressed={selected === value}
          onClick={() => onSelect(value)}
          className={cn('h-14 text-xl font-semibold tabular-nums')}
        >
          {value}
        </Button>
      ))}
    </div>
  )
}

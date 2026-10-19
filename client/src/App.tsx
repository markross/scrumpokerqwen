import type { ReactElement } from 'react'

import { JoinScreen } from '@/components/JoinScreen'
import { Room } from '@/components/Room'
import { useRoom } from '@/useRoom'

export default function App(): ReactElement {
  const api = useRoom()

  if (!api.room) {
    return (
      <JoinScreen
        onCreate={api.createRoom}
        onJoin={api.joinRoom}
        onJoinByName={api.joinByName}
        error={api.error}
        busy={api.busy}
      />
    )
  }

  return (
    <Room
      state={api.room}
      meId={api.meId}
      connected={api.connected}
      onVote={api.vote}
      onReveal={api.reveal}
      onReset={api.reset}
      onLeave={api.leave}
    />
  )
}

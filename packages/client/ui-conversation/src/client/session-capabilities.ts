import { useEffect, useState } from 'react'
import type { SessionCapabilities } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/** Fail-closed capability snapshot used before and after an unavailable read. */
export const UNAVAILABLE_SESSION_CAPABILITIES: SessionCapabilities = Object.freeze({
  imageInput: false,
  modelSelection: false,
  fork: false,
})

/** Read one session's operation admission without introducing a second store. */
export function useSessionCapabilities(
  sessionId: SessionId | undefined,
  load: (sessionId: SessionId) => Promise<SessionCapabilities>,
): SessionCapabilities {
  const [capabilities, setCapabilities] = useState(UNAVAILABLE_SESSION_CAPABILITIES)

  useEffect(() => {
    let current = true
    setCapabilities(UNAVAILABLE_SESSION_CAPABILITIES)
    if (sessionId !== undefined) {
      void load(sessionId).then((next) => {
        if (current) setCapabilities(next)
      }).catch(() => {
        // Loading and transport/schema failures retain the fail-closed snapshot.
      })
    }
    return () => { current = false }
  }, [load, sessionId])

  return capabilities
}

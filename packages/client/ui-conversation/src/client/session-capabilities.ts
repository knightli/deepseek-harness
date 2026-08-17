import { useEffect, useState } from 'react'
import type { SessionCapabilities } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/** Fail-closed capability snapshot used before and after an unavailable read. */
export const UNAVAILABLE_SESSION_CAPABILITIES: SessionCapabilities = Object.freeze({
  imageInput: false,
  modelSelection: false,
  fork: false,
})

interface LoadedSessionCapabilities {
  readonly sessionId: SessionId | undefined
  readonly load: (sessionId: SessionId) => Promise<SessionCapabilities>
  readonly capabilities: SessionCapabilities
}

/**
 * Read one session's operation admission without introducing a second store.
 * @param sessionId - exact session whose operations the caller may expose.
 * @param load - current authoritative capability reader.
 * @returns the matching loaded snapshot, or the fail-closed snapshot while unavailable.
 */
export function useSessionCapabilities(
  sessionId: SessionId | undefined,
  load: (sessionId: SessionId) => Promise<SessionCapabilities>,
): SessionCapabilities {
  const [loaded, setLoaded] = useState<LoadedSessionCapabilities>()

  useEffect(() => {
    let current = true
    if (sessionId !== undefined) {
      void load(sessionId).then((next) => {
        if (current) setLoaded({ sessionId, load, capabilities: next })
      }).catch(() => {
        // Loading and transport/schema failures retain the fail-closed snapshot.
      })
    }
    return () => { current = false }
  }, [load, sessionId])

  return loaded !== undefined && loaded.sessionId === sessionId && loaded.load === load
    ? loaded.capabilities
    : UNAVAILABLE_SESSION_CAPABILITIES
}

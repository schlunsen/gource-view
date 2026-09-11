import { useEffect, useState } from 'react'

// Phones in portrait and phones held sideways share the compact viewer layout.
export const COMPACT_QUERY = '(max-width: 767px), (max-height: 500px)'

/** Live boolean for a CSS media query. */
export function useMediaQuery(query) {
  const read = () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches
  const [matches, setMatches] = useState(read)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

import { getSetting } from './database'

const AW_BASE = 'http://localhost:5600/api/0'

export interface AWEvent {
  id: number
  timestamp: string
  duration: number
  data: {
    app?: string
    title?: string
    url?: string
    [key: string]: unknown
  }
}

export interface AWAfkEvent {
  id: number
  timestamp: string
  duration: number
  data: {
    status: 'afk' | 'non-afk'
    [key: string]: unknown
  }
}

export interface AWBucket {
  id: string
  type: string
  client: string
  hostname: string
  created: string
  data: {
    [key: string]: unknown
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`ActivityWatch HTTP ${response.status}: ${response.statusText}`)
    }
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

export async function checkActivityWatch(): Promise<boolean> {
  try {
    await fetchJson(`${AW_BASE}/info`)
    return true
  } catch {
    return false
  }
}

export async function getBuckets(): Promise<AWBucket[]> {
  const data = await fetchJson(`${AW_BASE}/buckets`) as Record<string, AWBucket>
  return Object.values(data)
}

export async function getWindowEvents(bucketId: string, start: string, end: string): Promise<AWEvent[]> {
  const params = new URLSearchParams({
    start,
    end,
    limit: '100000',
  })
  const data = await fetchJson(`${AW_BASE}/buckets/${bucketId}/events?${params}`) as AWEvent[]
  return data
}

/**
 * Find suitable window-event buckets (afk or window) sorted by recency.
 */
export async function findWindowBuckets(): Promise<AWBucket[]> {
  const buckets = await getBuckets()
  
  // Prefer 'window' type buckets, fallback to 'afkstatus' or anything with window data
  const windowBuckets = buckets.filter(b => b.type === 'window')
  const afkBuckets = buckets.filter(b => b.type === 'afkstatus')
  const currentBuckets = buckets.filter(b => b.type === 'currentwindow')

  // Return window buckets sorted by most recently created
  const sorted = [...windowBuckets, ...currentBuckets].sort(
    (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
  )

  if (sorted.length > 0) return sorted
  return afkBuckets
}

/**
 * Fetch events from a specific time range, returning the raw event data.
 * @param start ISO start time
 * @param end ISO end time
 */
export async function fetchEventsSince(start: string, end: string): Promise<AWEvent[]> {
  const buckets = await findWindowBuckets()
  if (buckets.length === 0) return []

  // Collect events from all window buckets (usually just one)
  const allEvents: AWEvent[] = []
  for (const bucket of buckets.slice(0, 2)) {
    try {
      const events = await getWindowEvents(bucket.id, start, end)
      allEvents.push(...events)
    } catch (err) {
      console.error(`Failed to fetch from bucket ${bucket.id}:`, err)
    }
  }

  // Deduplicate by id and sort by timestamp
  const seen = new Set<number>()
  const unique = allEvents.filter(e => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    return true
  })

  unique.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  return unique
}

/**
 * Check if an AW event overlaps with an AFK (away-from-keyboard) period.
 * Returns true if the event should be filtered out.
 */
export function isOverlappingAfk(
  eventStart: Date,
  eventDuration: number,
  afkPeriods: { start: Date; end: Date }[]
): boolean {
  const eventEnd = new Date(eventStart.getTime() + eventDuration * 1000)
  for (const afk of afkPeriods) {
    if (eventStart < afk.end && eventEnd > afk.start) {
      const overlapStart = eventStart > afk.start ? eventStart : afk.start
      const overlapEnd = eventEnd < afk.end ? eventEnd : afk.end
      const overlapSec = (overlapEnd.getTime() - overlapStart.getTime()) / 1000
      if (overlapSec / eventDuration > 0.5) return true
    }
  }
  return false
}

/**
 * Fetch AFK (away-from-keyboard) events from AW's afkstatus bucket.
 * Returns AFK time ranges (start→end).
 */
export async function fetchAfkSince(start: string, end: string): Promise<{ start: Date; end: Date }[]> {
  const buckets = await getBuckets()
  const afkBuckets = buckets.filter(b => b.type === 'afkstatus')
  if (afkBuckets.length === 0) return []

  const afkPeriods: { start: Date; end: Date }[] = []
  for (const bucket of afkBuckets.slice(0, 1)) {
    try {
      const params = new URLSearchParams({ start, end, limit: '100000' })
      const events = await fetchJson(`${AW_BASE}/buckets/${bucket.id}/events?${params}`) as AWAfkEvent[]
      for (const e of events) {
        if (e.data?.status === 'afk') {
          afkPeriods.push({
            start: new Date(e.timestamp),
            end: new Date(new Date(e.timestamp).getTime() + e.duration * 1000),
          })
        }
      }
    } catch (err) {
      console.error('[afk] Failed to fetch afkstatus bucket:', err)
    }
  }
  return afkPeriods
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Publishes inbox realtime events over Socket.io.
 *
 * The client side has always been wired up — `useRealtime` joins the tenant
 * room and listens for `message` / `conversation` — but nothing on the server
 * ever called `triggerRealtimeEvent`, so the inbox only updated on a manual
 * refresh, a tab refocus, or a socket reconnect. These helpers are the
 * missing publishers.
 *
 * Payloads mirror the Supabase realtime shape the inbox already parses:
 * `{ eventType: 'INSERT' | 'UPDATE', new: <snake_case row>, old }`.
 *
 * Everything here is best-effort. Realtime is a convenience layer over state
 * already committed to the database, so a failure must never break the
 * request that triggered it — callers can safely `void` these.
 */
import { prisma } from '@/lib/prisma'
import { triggerRealtimeEvent } from '@/lib/realtime'

type EventType = 'INSERT' | 'UPDATE'

function toSnakeCase(value: any): any {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(toSnakeCase)
  if (value instanceof Date) return value.toISOString()
  if (value && value.constructor && value.constructor.name === 'Decimal') {
    return Number(value.toString())
  }
  if (typeof value !== 'object') return value

  const out: any = {}
  for (const key of Object.keys(value)) {
    out[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] = toSnakeCase(value[key])
  }
  return out
}

/**
 * Publishes a message row plus the conversation it belongs to: the thread
 * needs the bubble, the list needs the reordered preview and unread badge.
 *
 * Takes an id rather than a row because callers persist through four
 * different layers (repository, raw Prisma, both Supabase shims) and the
 * shapes they hold differ. One read here keeps every call site identical.
 */
export async function emitNewMessage(
  messageId: string,
  options?: { eventType?: EventType },
): Promise<void> {
  try {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    })
    if (!message) return

    const { conversation, ...row } = message
    const tenantId = conversation?.tenantId
    if (!tenantId) return

    triggerRealtimeEvent(tenantId, 'message', {
      eventType: options?.eventType ?? 'INSERT',
      new: toSnakeCase(row),
      old: {},
    })

    triggerRealtimeEvent(tenantId, 'conversation', {
      eventType: 'UPDATE',
      new: toSnakeCase(conversation),
      old: {},
    })
  } catch (error) {
    console.warn('[Realtime] failed to emit message event:', error)
  }
}

/**
 * Publishes a conversation change on its own — status, assignment, unread
 * reset, or a brand new thread appearing in the list.
 */
export async function emitConversationChange(
  conversationId: string,
  options?: { eventType?: EventType },
): Promise<void> {
  try {
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } })
    if (!conversation?.tenantId) return

    triggerRealtimeEvent(conversation.tenantId, 'conversation', {
      eventType: options?.eventType ?? 'UPDATE',
      new: toSnakeCase(conversation),
      old: {},
    })
  } catch (error) {
    console.warn('[Realtime] failed to emit conversation event:', error)
  }
}

/** Publishes a message status transition (sent → delivered → read → failed). */
export async function emitMessageStatus(messageId: string): Promise<void> {
  await emitNewMessage(messageId, { eventType: 'UPDATE' })
}

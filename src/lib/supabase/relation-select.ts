/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Translates PostgREST-style embedded selects into a Prisma `include`.
 *
 * The Supabase shims accept the query strings the inbox already writes, e.g.
 *
 *   .select('*, contact:contacts(*)')
 *   .select('*, contact:contacts(*, tags:contact_tags(*, tag:tags(*)))')
 *
 * Before this existed both shims dropped the string on the floor and ran a
 * bare `findMany`, so every embedded relation came back `undefined`. In the
 * inbox that meant `conversation.contact` was always missing, which made the
 * list render "Unknown", stopped the message thread from opening, and made
 * /api/whatsapp/send reject replies with "Contact phone number not found".
 *
 * Relation names are resolved against the real Prisma schema via the DMMF,
 * so a typo or an unmapped table is skipped rather than throwing a 500 —
 * matching the previous lenient behaviour.
 */
import { Prisma } from '@prisma/client'

type DmmfField = { name: string; kind: string; type: string; isList: boolean }
type DmmfModel = { name: string; fields: DmmfField[] }

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

function toCamel(s: string): string {
  return s.trim().replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

/** Naive de-pluralisation: 'contacts' -> 'contact'. Good enough for table names. */
function singular(s: string): string {
  if (s.endsWith('ies')) return `${s.slice(0, -3)}y`
  if (s.endsWith('ses')) return s.slice(0, -2)
  if (s.endsWith('s')) return s.slice(0, -1)
  return s
}

let modelIndex: Map<string, DmmfModel> | null = null

/** Indexes the schema once, keyed by the lower-camel model name Prisma exposes on the client. */
function getModel(modelName: string): DmmfModel | undefined {
  if (!modelIndex) {
    modelIndex = new Map()
    for (const model of (Prisma.dmmf?.datamodel?.models ?? []) as unknown as DmmfModel[]) {
      modelIndex.set(lowerFirst(model.name).toLowerCase(), model)
    }
  }
  return modelIndex.get(lowerFirst(modelName).toLowerCase())
}

/** Splits on commas that sit outside any parentheses. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of input) {
    if (char === '(') depth++
    else if (char === ')') depth--
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts.map((p) => p.trim()).filter(Boolean)
}

/**
 * Matches an embedded select head against the model's relation fields.
 * `contact:contacts(*)` gives alias 'contact' and target 'contacts'; either
 * may identify the relation, as may the related model's own name.
 */
function resolveRelation(
  model: DmmfModel,
  alias: string | null,
  target: string,
): DmmfField | undefined {
  const relations = model.fields.filter((f) => f.kind === 'object')
  const candidates = [alias, target, singular(target)]
    .filter((c): c is string => Boolean(c))
    .map((c) => toCamel(c).toLowerCase())

  return relations.find((rel) => {
    const relName = rel.name.toLowerCase()
    const relType = lowerFirst(rel.type).toLowerCase()
    return candidates.some((c) => c === relName || c === relType || c === singular(relName))
  })
}

/**
 * Builds a Prisma `include` object, or `undefined` when the select string
 * names no embedded relations (the common `'*'` case).
 */
export function buildPrismaInclude(
  modelName: string,
  fields?: string | null,
): Record<string, any> | undefined {
  if (!fields || !fields.includes('(')) return undefined

  const model = getModel(modelName)
  if (!model) return undefined

  const include: Record<string, any> = {}

  for (const segment of splitTopLevel(fields)) {
    const open = segment.indexOf('(')
    if (open === -1) continue // a plain column, not an embed

    const close = segment.lastIndexOf(')')
    if (close < open) continue

    const head = segment.slice(0, open).trim()
    const inner = segment.slice(open + 1, close)

    const colon = head.indexOf(':')
    const alias = colon === -1 ? null : head.slice(0, colon).trim()
    const target = colon === -1 ? head : head.slice(colon + 1).trim()
    if (!target) continue

    const relation = resolveRelation(model, alias, target)
    if (!relation) continue

    const nested = buildPrismaInclude(relation.type, inner)
    include[relation.name] = nested ? { include: nested } : true
  }

  return Object.keys(include).length > 0 ? include : undefined
}

// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import type { NodeId, ProximityExpression, ProximityFalloff, ProximityTargetPropertyId } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'

const FALLOFF_OPTIONS: { value: ProximityFalloff; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Ease In' },
  { value: 'ease-out', label: 'Ease Out' },
  { value: 'ease-in-out', label: 'Ease In Out' },
  { value: 'step', label: 'Step' },
]

const PROPERTY_OPTIONS: { value: ProximityTargetPropertyId; label: string }[] = [
  { value: 'transform.x', label: 'Position X' },
  { value: 'transform.y', label: 'Position Y' },
  { value: 'transform.z', label: 'Position Z' },
  { value: 'transform.rotation', label: 'Rotation' },
  { value: 'transform.scaleX', label: 'Scale X' },
  { value: 'transform.scaleY', label: 'Scale Y' },
  { value: 'appearance.opacity', label: 'Opacity' },
  { value: 'appearance.cornerRadius', label: 'Corner Radius' },
]

function freshId(): string {
  return `prox-${Math.random().toString(36).slice(2, 10)}`
}

function freshExpression(triggerNodeId: string): ProximityExpression {
  return {
    id: freshId(),
    triggerNodeId,
    radius: 200,
    falloff: 'linear',
    effects: [{ propertyId: 'appearance.opacity', from: 0, to: -0.5 }],
    enabled: true,
  }
}

const fieldClass =
  'h-7 w-full rounded border border-border bg-panel px-2 text-[11px] text-text focus:border-accent focus:outline-none'
const labelClass = 'text-[10px] font-medium text-text-muted'
const btnClass =
  'flex h-7 w-full items-center justify-center rounded-md border border-border bg-panel-raised text-[11px] font-medium text-text-muted hover:border-border-strong hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent'

export function ProximityExpressionSection({
  api,
  nodeId,
  expressions,
}: {
  api: SceneAPI
  nodeId: NodeId
  expressions: ProximityExpression[] | null | undefined
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const list = expressions ?? []

  const commit = (next: ProximityExpression[]) => {
    api.doc.transact(() => {
      api.setNodeProperty(nodeId, 'proximityExpressions', next.length > 0 ? next : null)
    }, UNDOABLE_GESTURE_ORIGIN)
  }

  const addExpression = () => {
    const allNodeIds = api.getAllNodeIds().filter((id) => id !== nodeId)
    const trigger = allNodeIds[0]
    if (!trigger) return
    const expr = freshExpression(trigger)
    commit([...list, expr])
    setExpandedId(expr.id)
  }

  const removeExpression = (id: string) => {
    commit(list.filter((e) => e.id !== id))
    if (expandedId === id) setExpandedId(null)
  }

  const updateExpression = (id: string, patch: Partial<ProximityExpression>) => {
    commit(list.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }

  const addEffect = (exprId: string) => {
    const expr = list.find((e) => e.id === exprId)
    if (!expr) return
    const used = new Set(expr.effects.map((e) => e.propertyId))
    const available = PROPERTY_OPTIONS.find((p) => !used.has(p.value))
    if (!available) return
    updateExpression(exprId, {
      effects: [...expr.effects, { propertyId: available.value, from: 0, to: 0 }],
    })
  }

  const removeEffect = (exprId: string, index: number) => {
    const expr = list.find((e) => e.id === exprId)
    if (!expr) return
    updateExpression(exprId, {
      effects: expr.effects.filter((_, i) => i !== index),
    })
  }

  const updateEffect = (
    exprId: string,
    index: number,
    patch: Partial<ProximityExpression['effects'][number]>,
  ) => {
    const expr = list.find((e) => e.id === exprId)
    if (!expr) return
    updateExpression(exprId, {
      effects: expr.effects.map((e, i) => (i === index ? { ...e, ...patch } : e)),
    })
  }

  const allNodeIds = api.getAllNodeIds()
  const nodeOptions = allNodeIds
    .filter((id) => id !== nodeId)
    .map((id) => {
      const n = api.getNode(id)
      return { id, name: n?.name ?? id }
    })

  return (
    <section className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="mb-2 flex h-6 items-center justify-between">
        <span className="text-[12px] font-bold text-text">Proximity</span>
      </div>
      {list.length === 0 ? (
        <>
          <button type="button" onClick={addExpression} className={btnClass}>
            Add proximity expression
          </button>
          <p className="text-[10px] leading-4 text-text-dim">
            React to a trigger element's distance with progressive effects.
          </p>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((expr) => {
            const expanded = expandedId === expr.id
            return (
              <div
                key={expr.id}
                className="rounded-md border border-border bg-panel-raised"
              >
                <div className="flex items-center justify-between px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : expr.id)}
                    className="flex-1 text-left text-[11px] font-medium text-text"
                  >
                    {api.getNode(expr.triggerNodeId)?.name ?? 'Trigger'} →{' '}
                    {expr.effects.length} effect{expr.effects.length !== 1 ? 's' : ''}
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        updateExpression(expr.id, { enabled: !expr.enabled })
                      }
                      className={`rounded px-1 py-0.5 text-[10px] ${
                        expr.enabled
                          ? 'text-accent'
                          : 'text-text-dim'
                      }`}
                      title={expr.enabled ? 'Disable' : 'Enable'}
                    >
                      {expr.enabled ? 'ON' : 'OFF'}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeExpression(expr.id)}
                      className="rounded px-1 py-0.5 text-[10px] text-text-dim hover:text-text"
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="flex flex-col gap-2 border-t border-border px-2 py-2">
                    <div>
                      <label className={labelClass}>Trigger</label>
                      <select
                        value={expr.triggerNodeId}
                        onChange={(e) =>
                          updateExpression(expr.id, {
                            triggerNodeId: e.target.value,
                          })
                        }
                        className={fieldClass}
                      >
                        {nodeOptions.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className={labelClass}>Radius</label>
                        <input
                          type="number"
                          value={expr.radius}
                          min={0}
                          onChange={(e) =>
                            updateExpression(expr.id, {
                              radius: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          className={fieldClass}
                        />
                      </div>
                      <div className="flex-1">
                        <label className={labelClass}>Falloff</label>
                        <select
                          value={expr.falloff}
                          onChange={(e) =>
                            updateExpression(expr.id, {
                              falloff: e.target.value as ProximityFalloff,
                            })
                          }
                          className={fieldClass}
                        >
                          {FALLOFF_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="mt-1">
                      <div className="flex items-center justify-between">
                        <span className={labelClass}>Effects</span>
                        <button
                          type="button"
                          onClick={() => addEffect(expr.id)}
                          className="text-[10px] text-accent hover:underline"
                        >
                          + Add
                        </button>
                      </div>
                      {expr.effects.map((effect, i) => (
                        <div
                          key={`${effect.propertyId}-${i}`}
                          className="mt-1 flex items-end gap-1"
                        >
                          <div className="flex-1">
                            {i === 0 && (
                              <label className={labelClass}>Property</label>
                            )}
                            <select
                              value={effect.propertyId}
                              onChange={(e) =>
                                updateEffect(expr.id, i, {
                                  propertyId:
                                    e.target.value as ProximityTargetPropertyId,
                                })
                              }
                              className={fieldClass}
                            >
                              {PROPERTY_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="w-14">
                            {i === 0 && (
                              <label className={labelClass}>From</label>
                            )}
                            <input
                              type="number"
                              value={effect.from}
                              onChange={(e) =>
                                updateEffect(expr.id, i, {
                                  from: Number(e.target.value) || 0,
                                })
                              }
                              className={fieldClass}
                            />
                          </div>
                          <div className="w-14">
                            {i === 0 && (
                              <label className={labelClass}>To</label>
                            )}
                            <input
                              type="number"
                              value={effect.to}
                              onChange={(e) =>
                                updateEffect(expr.id, i, {
                                  to: Number(e.target.value) || 0,
                                })
                              }
                              className={fieldClass}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeEffect(expr.id, i)}
                            className="mb-0.5 text-[10px] text-text-dim hover:text-text"
                            title="Remove effect"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          <button type="button" onClick={addExpression} className={btnClass}>
            + Add expression
          </button>
        </div>
      )}
    </section>
  )
}

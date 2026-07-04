"use client"

import { useEffect, useMemo, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ConversationsSeriesPoint } from '@/lib/dashboard/types'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'
import { cn } from '@/lib/utils'

type RangeDays = 7 | 30 | 90

interface ConversationsChartProps {
  /** Per-range data, so switching tabs never re-fetches. */
  series: Record<RangeDays, ConversationsSeriesPoint[] | null>
  loading: boolean
  range: RangeDays
  onRangeChange: (r: RangeDays) => void
}

export function ConversationsChart({ series, loading, range, onRangeChange }: ConversationsChartProps) {
  const data = series[range]

  // Check if data is entirely empty/zeroes
  const isEmpty =
    !data ||
    data.every((p) => p.incoming === 0 && p.outgoing === 0)

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Conversations Over Time</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Daily message volume by direction</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1">
          {[7, 30, 90].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRangeChange(r as RangeDays)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                range === r
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {r} days
            </button>
          ))}
        </div>
      </header>

      <div className="p-5 flex-1 min-h-[280px]">
        {loading || !data ? (
          <Skeleton className="h-full w-full" />
        ) : isEmpty ? (
          <EmptyState
            icon={MessageSquare}
            title="No message activity in this range"
            hint="Send or receive messages to start populating this chart."
          />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
            >
              <defs>
                <linearGradient id="colorIncoming" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorOutgoing" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.5} />
              <XAxis
                dataKey="day"
                tickFormatter={shortDayLabel}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                dy={10}
                minTickGap={20}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                tickFormatter={(value) => niceCeil(value).toString()} // Simplistic
                allowDecimals={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="outgoing"
                stroke="#7c3aed"
                fillOpacity={1}
                fill="url(#colorOutgoing)"
                strokeWidth={2}
                activeDot={{ r: 4, strokeWidth: 0, fill: '#7c3aed' }}
              />
              <Area
                type="monotone"
                dataKey="incoming"
                stroke="#3b82f6"
                fillOpacity={1}
                fill="url(#colorIncoming)"
                strokeWidth={2}
                activeDot={{ r: 4, strokeWidth: 0, fill: '#3b82f6' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <footer className="flex items-center gap-4 border-t border-border px-5 py-3 text-xs text-muted-foreground">
        <LegendDot color="#3b82f6" label="Incoming" />
        <LegendDot color="#7c3aed" label="Outgoing" />
      </footer>
    </section>
  )
}

function CustomTooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    const incoming = payload.find((p: any) => p.dataKey === 'incoming')?.value || 0
    const outgoing = payload.find((p: any) => p.dataKey === 'outgoing')?.value || 0
    return (
      <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11px] shadow-lg">
        <div className="font-medium text-popover-foreground">{longDayLabel(label)}</div>
        <div className="mt-1 flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-blue-500">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
            {incoming} incoming
          </span>
          <span className="flex items-center gap-1.5 text-violet-500">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-500" />
            {outgoing} outgoing
          </span>
        </div>
      </div>
    )
  }
  return null
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}

function shortDayLabel(key: string): string {
  if (!key) return ''
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function longDayLabel(key: string): string {
  if (!key) return ''
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function niceCeil(val: number): number {
  if (val === 0) return 0
  if (val <= 4) return val
  return val
}

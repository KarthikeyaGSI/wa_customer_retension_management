import { useState } from 'react'
import { GitBranch } from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Sector } from 'recharts'
import type { PipelineDonutData } from '@/lib/dashboard/types'
import { formatCurrencyShort } from '@/lib/currency'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface PipelineDonutProps {
  data: PipelineDonutData | null
  loading: boolean
  /** Account default currency for the totals. */
  currency: string
}

export function PipelineDonut({ data, loading, currency }: PipelineDonutProps) {
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined)

  const onPieEnter = (_: any, index: number) => {
    setActiveIndex(index)
  }

  const onPieLeave = () => {
    setActiveIndex(undefined)
  }

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Pipeline Value</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Open deals by stage
        </p>
      </header>

      <div className="flex flex-1 flex-col p-5">
        {loading || !data ? (
          <Skeleton className="h-56 w-full" />
        ) : data.stages.length === 0 ? (
          <EmptyState
            icon={GitBranch}
            title="No open deals yet"
            hint="Create deals in Pipelines to see stage breakdowns here."
          />
        ) : (
          <>
            <div className="flex h-48 items-center justify-center relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.stages}
                    dataKey="totalValue"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={88}
                    stroke="var(--card)"
                    strokeWidth={2}
                    // @ts-expect-error Recharts 3.x type mismatch for Pie active props
                    activeIndex={activeIndex}
                    // @ts-expect-error Recharts 3.x type mismatch for Pie active props
                    activeShape={renderActiveShape}
                    onMouseEnter={onPieEnter}
                    onMouseLeave={onPieLeave}
                  >
                    {data.stages.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              {/* Center Label positioned absolutely to avoid custom label renderer complexity during hover */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-[11px] text-muted-foreground">Total</span>
                <span className="text-[18px] font-semibold tabular-nums text-foreground">
                  {formatCurrencyShort(data.totalValue, currency)}
                </span>
              </div>
            </div>
            <ul className="mt-5 space-y-2">
              {data.stages.map((s, idx) => (
                <li
                  key={s.id}
                  className={`flex items-center gap-3 text-xs p-1.5 rounded-md transition-colors ${activeIndex === idx ? 'bg-muted' : ''}`}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onMouseLeave={() => setActiveIndex(undefined)}
                >
                  <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ background: s.color }}
                    aria-hidden
                  />
                  <span className="flex-1 truncate text-muted-foreground">{s.name}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {s.dealCount} deal{s.dealCount === 1 ? '' : 's'}
                  </span>
                  <span className="w-20 text-right text-muted-foreground tabular-nums">
                    {formatCurrencyShort(s.totalValue, currency)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}

const renderActiveShape = (props: any) => {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props
  return (
    <g>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius - 4}
        outerRadius={outerRadius + 4}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
    </g>
  )
}

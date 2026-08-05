/**
 * Shared renderer UI primitives: Button, Checkbox, Badge, Spinner, ProgressBar,
 * Field, Input and Select. All styling is Tailwind-based on the sc64-* theme
 * CSS variables so the components inherit whichever theme is active.
 */
import React from 'react'
import { cn } from '../lib'

/**
 * Themed button. variant picks the visual style (default/primary/danger/ghost/
 * outline), size picks padding and font size; all native button props pass
 * through to the underlying <button>.
 */
export function Button({
  variant = 'default',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'outline'
  size?: 'sm' | 'md' | 'lg'
}): React.JSX.Element {
  const variants: Record<string, string> = {
    default: 'bg-sc64-panel border border-sc64-borderlight text-sc64-text hover:bg-sc64-borderlight/60',
    primary: 'bg-gradient-to-r from-sc64-accent to-sc64-accent2 text-sc64-deep hover:brightness-110 shadow-glow border border-transparent',
    danger: 'bg-sc64-bad/15 border border-sc64-bad/40 text-sc64-bad hover:bg-sc64-bad/25',
    ghost: 'bg-transparent border border-transparent text-sc64-muted hover:text-sc64-text hover:bg-sc64-panel',
    outline: 'bg-transparent border border-sc64-borderlight text-sc64-accent hover:bg-sc64-panel'
  }
  const sizes: Record<string, string> = {
    sm: 'px-2.5 py-1.5 text-xs rounded-md',
    md: 'px-4 py-2 text-sm rounded-lg',
    lg: 'px-6 py-3 text-base rounded-xl'
  }
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-sc64-accent/60',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  )
}

/**
 * Card-style checkbox row with an optional hint line; the whole card is
 * clickable. onChange receives the checked state of the hidden input.
 */
export function Checkbox({
  label,
  hint,
  checked,
  onChange,
  disabled,
  className
}: {
  label: React.ReactNode
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <label
      className={cn(
        'group flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all duration-150',
        checked
          ? 'border-sc64-accent/60 bg-sc64-accent/10'
          : 'border-sc64-border bg-sc64-panel/60 hover:border-sc64-borderlight',
        disabled && 'opacity-50 pointer-events-none',
        className
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer appearance-none rounded border border-sc64-borderlight bg-sc64-panel2 transition-all checked:border-sc64-accent checked:bg-sc64-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-sc64-accent/60"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-sc64-text">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-sc64-muted">{hint}</span> : null}
      </span>
    </label>
  )
}

/** Small pill label; tone selects the color scheme for status/type indicators. */
export function Badge({
  children,
  tone = 'default',
  className
}: {
  children: React.ReactNode
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'accent'
  className?: string
}): React.JSX.Element {
  const tones: Record<string, string> = {
    default: 'bg-sc64-panel text-sc64-muted border-sc64-borderlight',
    good: 'bg-sc64-good/10 text-sc64-good border-sc64-good/40',
    warn: 'bg-sc64-warn/10 text-sc64-warn border-sc64-warn/40',
    bad: 'bg-sc64-bad/10 text-sc64-bad border-sc64-bad/40',
    accent: 'bg-sc64-accent/10 text-sc64-accent border-sc64-accent/40'
  }
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium', tones[tone], className)}>
      {children}
    </span>
  )
}

/** Inline spinner for in-flight work; sized and colored via className. */
export function Spinner({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={cn('h-4 w-4 animate-spin text-sc64-accent', className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

/**
 * Labeled progress bar. Shows a percentage when max > 0, otherwise an animated
 * indeterminate track via the indeterminate flag.
 */
export function ProgressBar({ value, max, label, indeterminate }: { value: number; max: number; label?: string; indeterminate?: boolean }): React.JSX.Element {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div className="w-full">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-mono text-sc64-muted">{label}</span>
        {max > 0 ? <span className="font-mono text-sc64-muted">{Math.round(pct)}%</span> : null}
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-sc64-panel2 border border-sc64-border">
        <div
          className={cn('h-full rounded-full bg-gradient-to-r from-sc64-accent to-sc64-accent2 transition-[width] duration-200', indeterminate && 'animate-pulse')}
          style={{ width: indeterminate ? '40%' : `${pct}%` }}
        />
      </div>
    </div>
  )
}

/**
 * Form field wrapper: uppercase label above arbitrary children, with an
 * optional hint line below.
 */
export function Field({
  label,
  children,
  hint,
  className
}: {
  label: string
  children: React.ReactNode
  hint?: string
  className?: string
}): React.JSX.Element {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-sc64-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-sc64-muted">{hint}</span> : null}
    </label>
  )
}

/** Themed text input; accepts all native input attributes. */
export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return (
    <input
      className={cn(
        'w-full rounded-lg border border-sc64-borderlight bg-sc64-panel2 px-3 py-2 text-sm text-sc64-text placeholder-sc64-muted/60 transition-colors focus:border-sc64-accent focus:outline-none focus:ring-1 focus:ring-sc64-accent/40',
        className
      )}
      {...props}
    />
  )
}

/** Themed dropdown; accepts all native select attributes and children (options). */
export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <select
      className={cn(
        'w-full appearance-none rounded-lg border border-sc64-borderlight bg-sc64-panel2 px-3 py-2 text-sm text-sc64-text transition-colors focus:border-sc64-accent focus:outline-none focus:ring-1 focus:ring-sc64-accent/40',
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
}

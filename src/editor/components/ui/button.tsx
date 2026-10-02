import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/80',
        outline:
          'border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost: 'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        icon: 'size-8',
        'icon-xs':
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg',
        'icon-lg': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

/**
 * Catalyst-style layered construction for solid buttons.
 *
 * The base element paints `--btn-border` underneath a transparent 1px border,
 * the `before` layer paints `--btn-bg` inside the padding box (leaving a 1px
 * optical border), and the `after` layer carries the inset top highlight plus
 * the hover/active overlay.
 */
const solidLayers = [
  'border-transparent bg-(--btn-border)',
  'before:absolute before:inset-0 before:-z-10 before:rounded-[calc(var(--radius-md)-1px)] before:bg-(--btn-bg) before:shadow-2xs',
  'after:absolute after:inset-0 after:-z-10 after:rounded-[calc(var(--radius-md)-1px)]',
  'after:shadow-[inset_0_1px_oklch(1_0_0_/_0.15)]',
  'hover:after:bg-(--btn-hover-overlay) active:after:bg-(--btn-hover-overlay) aria-expanded:after:bg-(--btn-hover-overlay)',
  'disabled:before:shadow-none disabled:after:shadow-none',
].join(' ');

const flatLayers = [
  'border-transparent bg-(--btn-bg)',
  'hover:bg-[color-mix(in_oklab,var(--btn-bg),black_8%)] active:bg-[color-mix(in_oklab,var(--btn-bg),black_12%)] aria-expanded:bg-[color-mix(in_oklab,var(--btn-bg),black_8%)]',
].join(' ');

const catalystVariants = cva(
  [
    'group/button relative isolate inline-flex shrink-0 items-center justify-center rounded-md border text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,scale] duration-150 ease-out outline-none select-none',
    // outline-solid is required: the base outline-none sets
    // --tw-outline-style to none, which outline-2 alone inherits.
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring',
    'disabled:pointer-events-none disabled:opacity-50',
    'aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:text-(--btn-icon) [&_svg:not([class*='size-'])]:size-4",
  ].join(' '),
  {
    variants: {
      variant: {
        default: solidLayers,
        flat: flatLayers,
        destructive: [
          solidLayers,
          'text-white',
          '[--btn-bg:var(--destructive)]',
          '[--btn-border:color-mix(in_oklab,var(--color-red-700)_90%,transparent)]',
          '[--btn-hover-overlay:oklch(1_0_0_/_0.1)]',
          '[--btn-icon:var(--color-red-300)] hover:[--btn-icon:var(--color-red-200)]',
        ].join(' '),
        soft: 'border-transparent',
        outline: '',
        secondary:
          'border-transparent bg-zinc-950/5 text-zinc-950 hover:bg-zinc-950/10 active:bg-zinc-950/15 aria-expanded:bg-zinc-950/10 [--btn-icon:var(--color-zinc-500)] hover:[--btn-icon:var(--color-zinc-700)]',
        ghost: 'border-transparent',
        link: 'border-transparent text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-3.5 text-base has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-5 sm:h-9 sm:gap-1.5 sm:px-2.5 sm:text-sm sm:has-data-[icon=inline-end]:pr-2 sm:has-data-[icon=inline-start]:pl-2 sm:[&_svg:not([class*='size-'])]:size-4",
        icon: 'size-8',
        'icon-xs': "size-6 [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-7',
        'icon-lg': "size-11 [&_svg:not([class*='size-'])]:size-5 sm:size-9 sm:[&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

/**
 * Per-variant color recipes, keyed by color, in Catalyst style — solid
 * fills with a darker translucent border and a tinted icon, soft fills as
 * translucent tints with 700 text, outline borders at 600/30, ghost text 700.
 */
const catalystColors = {
  action:
    'text-white [--btn-bg:var(--color-action)] [--btn-border:color-mix(in_oklab,var(--color-action)_85%,oklch(0_0_0))] [--btn-hover-overlay:oklch(1_0_0_/_0.1)] [--btn-icon:oklch(1_0_0_/_0.7)] hover:[--btn-icon:oklch(1_0_0)] active:[--btn-icon:oklch(1_0_0)]',
  // Kite's flagship sky is too light for white labels (2.17), so it takes navy ones (7.30).
  brand:
    'text-navy [--btn-bg:var(--color-brand)] [--btn-border:color-mix(in_oklab,var(--color-brand)_85%,oklch(0_0_0))] [--btn-hover-overlay:oklch(1_0_0_/_0.15)] [--btn-icon:color-mix(in_oklab,var(--color-navy)_70%,transparent)] hover:[--btn-icon:var(--color-navy)] active:[--btn-icon:var(--color-navy)]',
  primary:
    'text-primary-foreground [--btn-bg:var(--primary)] [--btn-border:color-mix(in_oklab,var(--color-zinc-950)_90%,transparent)] [--btn-hover-overlay:oklch(1_0_0_/_0.1)] [--btn-icon:var(--color-zinc-400)] hover:[--btn-icon:var(--color-zinc-300)] active:[--btn-icon:var(--color-zinc-300)]',
  white:
    'text-zinc-950 [--btn-bg:oklch(1_0_0)] [--btn-border:color-mix(in_oklab,var(--color-zinc-950)_10%,transparent)] [--btn-hover-overlay:color-mix(in_oklab,var(--color-zinc-950)_2.5%,transparent)] [--btn-icon:var(--color-zinc-400)] hover:[--btn-icon:var(--color-zinc-500)] active:[--btn-icon:var(--color-zinc-500)]',
  zinc: 'text-white [--btn-bg:var(--color-zinc-600)] [--btn-border:color-mix(in_oklab,var(--color-zinc-700)_90%,transparent)] [--btn-hover-overlay:oklch(1_0_0_/_0.1)] [--btn-icon:var(--color-zinc-400)] hover:[--btn-icon:var(--color-zinc-300)] active:[--btn-icon:var(--color-zinc-300)]',
  indigo:
    'text-white [--btn-bg:var(--color-indigo-500)] [--btn-border:color-mix(in_oklab,var(--color-indigo-600)_90%,transparent)] [--btn-hover-overlay:oklch(1_0_0_/_0.1)] [--btn-icon:var(--color-indigo-300)] hover:[--btn-icon:var(--color-indigo-200)] active:[--btn-icon:var(--color-indigo-200)]',
  cyan: 'text-cyan-950 [--btn-bg:var(--color-cyan-300)] [--btn-border:color-mix(in_oklab,var(--color-cyan-400)_80%,transparent)] [--btn-hover-overlay:oklch(1_0_0_/_0.25)] [--btn-icon:var(--color-cyan-500)] hover:[--btn-icon:var(--color-cyan-600)] active:[--btn-icon:var(--color-cyan-600)]',
  red: 'text-white [--btn-bg:var(--color-red-600)] [--btn-border:color-mix(in_oklab,var(--color-red-700)_90%,transparent)] [--btn-hover-overlay:oklch(1_0_0_/_0.1)] [--btn-icon:var(--color-red-300)] hover:[--btn-icon:var(--color-red-200)] active:[--btn-icon:var(--color-red-200)]',
  orange:
    'text-white [--btn-bg:var(--color-orange-500)] [--btn-border:color-mix(in_oklab,var(--color-orange-600)_90%,transparent)] [--btn-hover-overlay:oklch(1_0_0_/_0.1)] [--btn-icon:var(--color-orange-300)] hover:[--btn-icon:var(--color-orange-200)] active:[--btn-icon:var(--color-orange-200)]',
  amber:
    'text-amber-950 [--btn-bg:var(--color-amber-400)] [--btn-border:color-mix(in_oklab,var(--color-amber-500)_80%,transparent)] [--btn-hover-overlay:oklch(1_0_0_/_0.25)] [--btn-icon:var(--color-amber-600)] hover:[--btn-icon:var(--color-amber-700)] active:[--btn-icon:var(--color-amber-700)]',
  yellow:
    'text-yellow-950 [--btn-bg:var(--color-yellow-300)] [--btn-border:color-mix(in_oklab,var(--color-yellow-400)_80%,transparent)] [--btn-hover-overlay:oklch(1_0_0_/_0.25)] [--btn-icon:var(--color-yellow-600)] hover:[--btn-icon:var(--color-yellow-700)] active:[--btn-icon:var(--color-yellow-700)]',
  lime: 'text-lime-950 [--btn-bg:var(--color-lime-300)] [--btn-border:color-mix(in_oklab,var(--color-lime-400)_80%,transparent)] [--btn-hover-overlay:oklch(1_0_0_/_0.25)] [--btn-icon:var(--color-lime-600)] hover:[--btn-icon:var(--color-lime-700)] active:[--btn-icon:var(--color-lime-700)]',
  green:
    'text-white [--btn-bg:var(--color-green-600)] [--btn-border:color-mix(in_oklab,var(--color-green-700)_90%,transparent)] [--btn-hover-overlay:oklch(1_0_0_/_0.1)] [--btn-icon:var(--color-green-300)] hover:[--btn-icon:var(--color-green-200)] active:[--btn-icon:var(--color-green-200)]',
  emerald:
    'text-white [--btn-bg:var(--color-emerald-600)] [--btn-border:color-mix(in_oklab,var(--color-emerald-700)_90%,transparent)] [--btn-hover-overlay:oklch(1_0_0_/_0.1)] [--btn-icon:var(--color-emerald-300)] hover:[--btn-icon:var(--color-emerald-200)] active:[--btn-icon:var(--color-emerald-200)]',
  teal: 'text-white [--btn-bg:var(--color-teal-600)] [--btn-border:color-mix(in_oklab,var(--color-teal-700)_90%,transparent)] [--btn-hover-overlay:oklch(1_0_0_/_0.1)] [--btn-icon:var(--color-teal-300)] hover:[--btn-icon:var(--color-teal-200)] active:[--btn-icon:var(--color-teal-200)]',
  sky: 'text-white [--btn-bg:var(--color-sky-500)] [--btn-border:color-mix(in_oklab,var(--color-sky-600)_80%,transparent)] [--btn-hover-overlay:oklch(1_0_0_/_0.1)] [--btn-icon:var(--color-sky-200)] hover:[--btn-icon:var(--color-sky-100)] active:[--btn-icon:var(--color-sky-100)]',
  blue: 'text-white [--btn-bg:var(--color-blue-600)] [--btn-border:color-mix(in_oklab,var(--color-blue-700)_90%,transparent)] [--btn-hover-overlay:oklch(1_0_0_/_0.1)] [--btn-icon:var(--color-blue-400)] hover:[--btn-icon:var(--color-blue-300)] active:[--btn-icon:var(--color-blue-300)]',
  violet:
    'text-white [--btn-bg:var(--color-violet-500)] [--btn-border:color-mix(in_oklab,var(--color-violet-600)_90%,transparent)] [--btn-hover-overlay:oklch(1_0_0_/_0.1)] [--btn-icon:var(--color-violet-300)] hover:[--btn-icon:var(--color-violet-200)] active:[--btn-icon:var(--color-violet-200)]',
  purple:
    'text-white [--btn-bg:var(--color-purple-500)] [--btn-border:color-mix(in_oklab,var(--color-purple-600)_90%,transparent)] [--btn-hover-overlay:oklch(1_0_0_/_0.1)] [--btn-icon:var(--color-purple-300)] hover:[--btn-icon:var(--color-purple-200)] active:[--btn-icon:var(--color-purple-200)]',
  fuchsia:
    'text-white [--btn-bg:var(--color-fuchsia-500)] [--btn-border:color-mix(in_oklab,var(--color-fuchsia-600)_90%,transparent)] [--btn-hover-overlay:oklch(1_0_0_/_0.1)] [--btn-icon:var(--color-fuchsia-300)] hover:[--btn-icon:var(--color-fuchsia-200)] active:[--btn-icon:var(--color-fuchsia-200)]',
  pink: 'text-white [--btn-bg:var(--color-pink-500)] [--btn-border:color-mix(in_oklab,var(--color-pink-600)_90%,transparent)] [--btn-hover-overlay:oklch(1_0_0_/_0.1)] [--btn-icon:var(--color-pink-300)] hover:[--btn-icon:var(--color-pink-200)] active:[--btn-icon:var(--color-pink-200)]',
  rose: 'text-white [--btn-bg:var(--color-rose-500)] [--btn-border:color-mix(in_oklab,var(--color-rose-600)_90%,transparent)] [--btn-hover-overlay:oklch(1_0_0_/_0.1)] [--btn-icon:var(--color-rose-300)] hover:[--btn-icon:var(--color-rose-200)] active:[--btn-icon:var(--color-rose-200)]',
} as const;

const catalystSoftColors: Partial<Record<CatalystColor, string>> = {
  action: 'bg-action/12 text-action-text hover:bg-action/18 active:bg-action/24 aria-expanded:bg-action/18',
  brand: 'bg-brand/12 text-(--brand-text) hover:bg-brand/18 active:bg-brand/24 aria-expanded:bg-brand/18',
  primary:
    'bg-zinc-950/5 text-zinc-950 hover:bg-zinc-950/10 active:bg-zinc-950/15 aria-expanded:bg-zinc-950/10 [--btn-icon:var(--color-zinc-500)] hover:[--btn-icon:var(--color-zinc-700)]',
  zinc: 'bg-zinc-600/10 text-zinc-700 hover:bg-zinc-600/20 active:bg-zinc-600/25 aria-expanded:bg-zinc-600/20',
  indigo: 'bg-indigo-500/15 text-indigo-700 hover:bg-indigo-500/25 active:bg-indigo-500/30 aria-expanded:bg-indigo-500/25',
  cyan: 'bg-cyan-400/20 text-cyan-700 hover:bg-cyan-400/30 active:bg-cyan-400/40 aria-expanded:bg-cyan-400/30',
  red: 'bg-red-500/15 text-red-700 hover:bg-red-500/25 active:bg-red-500/30 aria-expanded:bg-red-500/25',
  orange: 'bg-orange-500/15 text-orange-700 hover:bg-orange-500/25 active:bg-orange-500/30 aria-expanded:bg-orange-500/25',
  amber: 'bg-amber-400/20 text-amber-700 hover:bg-amber-400/30 active:bg-amber-400/40 aria-expanded:bg-amber-400/30',
  yellow: 'bg-yellow-400/20 text-yellow-700 hover:bg-yellow-400/30 active:bg-yellow-400/40 aria-expanded:bg-yellow-400/30',
  lime: 'bg-lime-400/20 text-lime-700 hover:bg-lime-400/30 active:bg-lime-400/40 aria-expanded:bg-lime-400/30',
  green: 'bg-green-500/15 text-green-700 hover:bg-green-500/25 active:bg-green-500/30 aria-expanded:bg-green-500/25',
  emerald: 'bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 active:bg-emerald-500/30 aria-expanded:bg-emerald-500/25',
  teal: 'bg-teal-500/15 text-teal-700 hover:bg-teal-500/25 active:bg-teal-500/30 aria-expanded:bg-teal-500/25',
  sky: 'bg-sky-500/15 text-sky-700 hover:bg-sky-500/25 active:bg-sky-500/30 aria-expanded:bg-sky-500/25',
  blue: 'bg-blue-500/15 text-blue-700 hover:bg-blue-500/25 active:bg-blue-500/30 aria-expanded:bg-blue-500/25',
  violet: 'bg-violet-500/15 text-violet-700 hover:bg-violet-500/25 active:bg-violet-500/30 aria-expanded:bg-violet-500/25',
  purple: 'bg-purple-500/15 text-purple-700 hover:bg-purple-500/25 active:bg-purple-500/30 aria-expanded:bg-purple-500/25',
  fuchsia: 'bg-fuchsia-500/15 text-fuchsia-700 hover:bg-fuchsia-500/25 active:bg-fuchsia-500/30 aria-expanded:bg-fuchsia-500/25',
  pink: 'bg-pink-500/15 text-pink-700 hover:bg-pink-500/25 active:bg-pink-500/30 aria-expanded:bg-pink-500/25',
  rose: 'bg-rose-500/15 text-rose-700 hover:bg-rose-500/25 active:bg-rose-500/30 aria-expanded:bg-rose-500/25',
};

const catalystOutlineColors: Partial<Record<CatalystColor, string>> = {
  action:
    'border-action/40 text-action-text hover:border-action/60 hover:bg-action/8 active:bg-action/12 aria-expanded:bg-action/8',
  brand: 'border-brand/40 text-(--brand-text) hover:border-brand/60 hover:bg-brand/8 active:bg-brand/12 aria-expanded:bg-brand/8',
  primary:
    'border-zinc-950/10 text-zinc-950 hover:bg-zinc-950/2.5 active:bg-zinc-950/5 aria-expanded:bg-zinc-950/2.5 [--btn-icon:var(--color-zinc-500)] hover:[--btn-icon:var(--color-zinc-700)] active:[--btn-icon:var(--color-zinc-700)]',
  zinc: 'border-zinc-600/30 text-zinc-700 hover:border-zinc-600/50 hover:bg-zinc-500/5 active:bg-zinc-500/10 aria-expanded:bg-zinc-500/5',
  indigo:
    'border-indigo-600/30 text-indigo-700 hover:border-indigo-600/50 hover:bg-indigo-500/5 active:bg-indigo-500/10 aria-expanded:bg-indigo-500/5',
  cyan: 'border-cyan-600/30 text-cyan-700 hover:border-cyan-600/50 hover:bg-cyan-500/5 active:bg-cyan-500/10 aria-expanded:bg-cyan-500/5',
  red: 'border-red-600/30 text-red-700 hover:border-red-600/50 hover:bg-red-500/5 active:bg-red-500/10 aria-expanded:bg-red-500/5',
  orange:
    'border-orange-600/30 text-orange-700 hover:border-orange-600/50 hover:bg-orange-500/5 active:bg-orange-500/10 aria-expanded:bg-orange-500/5',
  amber:
    'border-amber-600/30 text-amber-700 hover:border-amber-600/50 hover:bg-amber-500/5 active:bg-amber-500/10 aria-expanded:bg-amber-500/5',
  yellow:
    'border-yellow-600/30 text-yellow-700 hover:border-yellow-600/50 hover:bg-yellow-500/5 active:bg-yellow-500/10 aria-expanded:bg-yellow-500/5',
  lime: 'border-lime-600/30 text-lime-700 hover:border-lime-600/50 hover:bg-lime-500/5 active:bg-lime-500/10 aria-expanded:bg-lime-500/5',
  green:
    'border-green-600/30 text-green-700 hover:border-green-600/50 hover:bg-green-500/5 active:bg-green-500/10 aria-expanded:bg-green-500/5',
  emerald:
    'border-emerald-600/30 text-emerald-700 hover:border-emerald-600/50 hover:bg-emerald-500/5 active:bg-emerald-500/10 aria-expanded:bg-emerald-500/5',
  teal: 'border-teal-600/30 text-teal-700 hover:border-teal-600/50 hover:bg-teal-500/5 active:bg-teal-500/10 aria-expanded:bg-teal-500/5',
  sky: 'border-sky-600/30 text-sky-700 hover:border-sky-600/50 hover:bg-sky-500/5 active:bg-sky-500/10 aria-expanded:bg-sky-500/5',
  blue: 'border-blue-600/30 text-blue-700 hover:border-blue-600/50 hover:bg-blue-500/5 active:bg-blue-500/10 aria-expanded:bg-blue-500/5',
  violet:
    'border-violet-600/30 text-violet-700 hover:border-violet-600/50 hover:bg-violet-500/5 active:bg-violet-500/10 aria-expanded:bg-violet-500/5',
  purple:
    'border-purple-600/30 text-purple-700 hover:border-purple-600/50 hover:bg-purple-500/5 active:bg-purple-500/10 aria-expanded:bg-purple-500/5',
  fuchsia:
    'border-fuchsia-600/30 text-fuchsia-700 hover:border-fuchsia-600/50 hover:bg-fuchsia-500/5 active:bg-fuchsia-500/10 aria-expanded:bg-fuchsia-500/5',
  pink: 'border-pink-600/30 text-pink-700 hover:border-pink-600/50 hover:bg-pink-500/5 active:bg-pink-500/10 aria-expanded:bg-pink-500/5',
  rose: 'border-rose-600/30 text-rose-700 hover:border-rose-600/50 hover:bg-rose-500/5 active:bg-rose-500/10 aria-expanded:bg-rose-500/5',
};

const catalystGhostColors: Partial<Record<CatalystColor, string>> = {
  action: 'text-action-text hover:bg-action/10 active:bg-action/15 aria-expanded:bg-action/10',
  brand: 'text-(--brand-text) hover:bg-brand/10 active:bg-brand/15 aria-expanded:bg-brand/10',
  primary:
    'text-zinc-950 hover:bg-zinc-950/5 active:bg-zinc-950/5 aria-expanded:bg-zinc-950/5 [--btn-icon:var(--color-zinc-500)] hover:[--btn-icon:var(--color-zinc-700)] active:[--btn-icon:var(--color-zinc-700)]',
  zinc: 'text-zinc-700 hover:bg-zinc-500/10 active:bg-zinc-500/15 aria-expanded:bg-zinc-500/10',
  indigo: 'text-indigo-700 hover:bg-indigo-500/10 active:bg-indigo-500/15 aria-expanded:bg-indigo-500/10',
  cyan: 'text-cyan-700 hover:bg-cyan-500/10 active:bg-cyan-500/15 aria-expanded:bg-cyan-500/10',
  red: 'text-red-700 hover:bg-red-500/10 active:bg-red-500/15 aria-expanded:bg-red-500/10',
  orange: 'text-orange-700 hover:bg-orange-500/10 active:bg-orange-500/15 aria-expanded:bg-orange-500/10',
  amber: 'text-amber-700 hover:bg-amber-500/10 active:bg-amber-500/15 aria-expanded:bg-amber-500/10',
  yellow: 'text-yellow-700 hover:bg-yellow-500/10 active:bg-yellow-500/15 aria-expanded:bg-yellow-500/10',
  lime: 'text-lime-700 hover:bg-lime-500/10 active:bg-lime-500/15 aria-expanded:bg-lime-500/10',
  green: 'text-green-700 hover:bg-green-500/10 active:bg-green-500/15 aria-expanded:bg-green-500/10',
  emerald: 'text-emerald-700 hover:bg-emerald-500/10 active:bg-emerald-500/15 aria-expanded:bg-emerald-500/10',
  teal: 'text-teal-700 hover:bg-teal-500/10 active:bg-teal-500/15 aria-expanded:bg-teal-500/10',
  sky: 'text-sky-700 hover:bg-sky-500/10 active:bg-sky-500/15 aria-expanded:bg-sky-500/10',
  blue: 'text-blue-700 hover:bg-blue-500/10 active:bg-blue-500/15 aria-expanded:bg-blue-500/10',
  violet: 'text-violet-700 hover:bg-violet-500/10 active:bg-violet-500/15 aria-expanded:bg-violet-500/10',
  purple: 'text-purple-700 hover:bg-purple-500/10 active:bg-purple-500/15 aria-expanded:bg-purple-500/10',
  fuchsia: 'text-fuchsia-700 hover:bg-fuchsia-500/10 active:bg-fuchsia-500/15 aria-expanded:bg-fuchsia-500/10',
  pink: 'text-pink-700 hover:bg-pink-500/10 active:bg-pink-500/15 aria-expanded:bg-pink-500/10',
  rose: 'text-rose-700 hover:bg-rose-500/10 active:bg-rose-500/15 aria-expanded:bg-rose-500/10',
};

type CatalystColor = keyof typeof catalystColors;

type CatalystVariant = NonNullable<VariantProps<typeof catalystVariants>['variant']>;

const catalystRecipes: Partial<Record<CatalystVariant, Partial<Record<CatalystColor, string>>>> = {
  default: catalystColors,
  flat: catalystColors,
  soft: catalystSoftColors,
  outline: catalystOutlineColors,
  ghost: catalystGhostColors,
};

/** The stock shadcn button. */
type StockButtonProps = {
  catalyst?: false;
  variant?: VariantProps<typeof buttonVariants>['variant'];
  color?: never;
  static?: never;
};

/** The Catalyst button, from the Docflare platform. */
type CatalystButtonProps = {
  /** Draws the button in Catalyst's layered style. Off by default: most buttons stay stock shadcn. */
  catalyst: true;
  variant?: CatalystVariant;
  /** Hue for the default (solid), flat, soft, outline and ghost variants. */
  color?: CatalystColor;
  /**
   * Disables the scale-on-press feedback where motion would distract.
   * Dropdown triggers never scale, as Catalyst's don't: the menu opens on
   * press, so the shrink would read as a shake.
   */
  static?: boolean;
};

type ButtonProps = Omit<ButtonPrimitive.Props, 'color'> &
  Pick<VariantProps<typeof buttonVariants>, 'size'> &
  (StockButtonProps | CatalystButtonProps);

/**
 * A button: stock shadcn by default, or Catalyst-style with `catalyst`.
 *
 * `<Button catalyst color="action">` is a solid brand-blue button with Catalyst's
 * darker border, inset highlight and hover overlay. Both styles share the
 * sizes, and both are Base UI buttons, so `render` works the same.
 */
function Button({ className, size = 'default', ...props }: ButtonProps) {
  if (props.catalyst) {
    const { catalyst: _catalyst, variant = 'default', color = 'primary', static: isStatic = false, ...rest } = props;
    const recipes = catalystRecipes[variant];

    return (
      <ButtonPrimitive
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={cn(
          catalystVariants({ variant, size }),
          recipes && (recipes[color] ?? recipes.primary),
          !isStatic && '[&:not([aria-haspopup=menu])]:active:not-disabled:scale-[0.96]',
          className,
        )}
        {...rest}
      />
    );
  }

  const { catalyst: _catalyst, variant = 'default', color: _color, static: _static, ...rest } = props;

  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...rest} />;
}

export { Button, buttonVariants, catalystVariants, catalystColors };
export type { CatalystColor };

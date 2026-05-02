/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      /* ── All corners sharp (Octrascan flat aesthetic) ── */
      borderRadius: {
        lg:      '0',
        md:      '0',
        sm:      '0',
        DEFAULT: '0',
        full:    '9999px', /* keep for spinners/avatars */
      },

      /* ── Font stacks ── */
      fontFamily: {
        sans:  ['Fira Code', 'Tahoma', 'Segoe UI', 'Arial', 'sans-serif'],
        mono:  ['Fira Code', 'SF Mono', 'Consolas', 'Monaco', 'monospace'],
      },

      /* ── Font sizes — compact like Octrascan ── */
      fontSize: {
        '2xs': ['10px', { lineHeight: '1.4' }],
        xs:    ['11px', { lineHeight: '1.5' }],
        sm:    ['12px', { lineHeight: '1.55' }],
        base:  ['13px', { lineHeight: '1.6' }],
        md:    ['14px', { lineHeight: '1.6' }],
        lg:    ['16px', { lineHeight: '1.5' }],
        xl:    ['18px', { lineHeight: '1.4' }],
        '2xl': ['20px', { lineHeight: '1.35' }],
        '3xl': ['24px', { lineHeight: '1.3' }],
      },

      /* ── Tailwind color tokens → CSS variables ── */
      colors: {
        background:  'hsl(var(--background))',
        foreground:  'hsl(var(--foreground))',
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT:    'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT:    'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT:    'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT:    'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input:  'hsl(var(--input))',
        ring:   'hsl(var(--ring))',

        /* ── Octrascan semantic palette ── */
        oc: {
          surface:      'hsl(var(--oc-surface))',
          'surface-muted': 'hsl(var(--oc-surface-muted))',
          header:       'hsl(var(--oc-header))',
          border:       'hsl(var(--oc-border))',
          'border-dark':'hsl(var(--oc-border-dark))',
          primary:      'hsl(var(--oc-primary))',
          secondary:    'hsl(var(--oc-secondary-btn))',
          muted:        'hsl(var(--oc-muted-text))',
          label:        'hsl(var(--oc-label))',
          success:      'hsl(var(--oc-success))',
          warning:      'hsl(var(--oc-warning))',
          danger:       'hsl(var(--oc-danger))',
          teal:         'hsl(var(--oc-teal))',
        },

        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))',
          5: 'hsl(var(--chart-5))',
        },
      },

      /* ── Letter spacing ── */
      letterSpacing: {
        tighter: '-0.02em',
        tight:   '-0.01em',
        normal:  '0',
        wide:    '0.03em',
        wider:   '0.06em',
        widest:  '0.1em',
        octra:   '0.05em',   /* Octrascan label spacing */
      },

      /* ── Animations ── */
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to:   { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to:   { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up':   'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

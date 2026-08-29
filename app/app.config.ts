export default defineAppConfig({
  ui: {
    colors: {
      primary: 'red',
      neutral: 'stone',
    },
    button: {
      slots: {
        base: 'min-h-11 rounded-[var(--radius-control)] font-semibold',
      },
    },
    card: {
      slots: {
        root: 'rounded-[var(--radius-panel)] shadow-none',
      },
    },
    input: {
      slots: {
        base: 'min-h-11 rounded-[var(--radius-control)]',
      },
    },
    select: {
      slots: {
        base: 'min-h-11 rounded-[var(--radius-control)]',
      },
    },
    textarea: {
      slots: {
        base: 'rounded-[var(--radius-control)]',
      },
    },
  },
})

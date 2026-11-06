/** Small inline icons for Chat. Decorative: each button or link carries its own text for screen readers. */
const paths: Record<string, string> = {
  back: 'M15 19l-7-7 7-7',
  chat: 'M4 5h16v11H8l-4 4V5z',
  group: 'M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3 3 0 100-6 3 3 0 000 6zM21 19v-1a4 4 0 00-3-3.87M15.5 4.13a3 3 0 010 5.74',
  search: 'M21 21l-4.3-4.3M11 18a7 7 0 100-14 7 7 0 000 14z',
  clip: 'M21 11.5l-8.6 8.6a5 5 0 01-7.1-7.1l8.6-8.6a3.3 3.3 0 014.7 4.7l-8.6 8.6a1.7 1.7 0 01-2.4-2.4l7.9-7.9',
  smile: 'M12 21a9 9 0 100-18 9 9 0 000 18zM8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2M9 9.5h.01M15 9.5h.01',
  send: 'M4 12l16-8-6 16-2.5-6.5L4 12z',
  bell: 'M18 16v-5a6 6 0 10-12 0v5l-2 2h16l-2-2zM10 21h4',
  mute: 'M4 4l16 16M9 5.3A6 6 0 0118 11v3M6 9.5V16l-2 2h12M10 21h4',
  chevron: 'M6 9l6 6 6-6',
  down: 'M12 5v14M6 13l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8h.01',
  pin: 'M12 17v5M8 3h8l-1 7 3 4H6l3-4-1-7z',
  file: 'M14 3H6v18h12V7l-4-4zM14 3v4h4',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
}
export function Icon({ name, className = 'h-5 w-5' }: { name: keyof typeof paths; className?: string }) {
  return <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}><path d={paths[name]} /></svg>
}
/** Sent, delivered and read marks. The words are given separately, so state is never shown by colour alone. */
export function Ticks({ state }: { state: 'sent' | 'delivered' | 'read' }) {
  return (
    <svg aria-hidden viewBox="0 0 20 12" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={`inline-block h-3 w-4 ${state === 'read' ? 'text-brand-700' : 'text-slate-500'}`}>
      <path d="M1.5 6.5l3.5 3.5L11.5 2" />{state !== 'sent' && <path d="M8.5 9l1 1L18 2" />}
    </svg>
  )
}

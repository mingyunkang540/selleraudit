import type { CSSProperties } from 'react'
export type IconName = 'dashboard' | 'box' | 'layers' | 'grid' | 'link' | 'shield' | 'settings' | 'search' | 'arrow' | 'chevron' | 'close' | 'check' | 'alert' | 'clock' | 'external' | 'menu' | 'plus' | 'download' | 'refresh' | 'chevronLeft'
const paths: Record<IconName, string> = {
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  box: 'M12 3 3 7.5v9L12 21l9-4.5v-9L12 3z M3 7.5 12 12l9-4.5 M12 12v9 M7.5 5.2l9 4.5',
  layers: 'm12 3 10 5-10 5L2 8l10-5z M2 12l10 5 10-5 M2 16l10 5 10-5',
  grid: 'M3 4h18v16H3z M3 9h18 M3 14h18 M9 4v16 M15 4v16',
  link: 'm10 13 4-4 M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
  shield: 'M12 3 3 6v6c0 5 9 9 9 9s9-4 9-9V6l-9-3z m-4 9 3 3 5-6',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3z',
  search: 'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15 M16 16l5 5',
  arrow: 'M4 12h16 m-6-6 6 6-6 6', chevron: 'm9 5 7 7-7 7', chevronLeft: 'm15 5-7 7 7 7',
  close: 'm6 6 12 12 M6 18 18 6', check: 'm5 12 4 4L19 6', alert: 'M12 3 2 21h20L12 3z M12 9v5 M12 17v.5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v6l4 2', external: 'M14 3h7v7 M21 3 11 13 M10 3H3v18h18v-7',
  menu: 'M3 6h18 M3 12h18 M3 18h18', plus: 'M12 5v14 M5 12h14', download: 'M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5', refresh: 'M20 8a9 9 0 1 0 0 8 M20 3v5h-5',
}
export function Icon({ name, size = 18, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={style}><path d={paths[name]} /></svg>
}

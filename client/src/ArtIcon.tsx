/** Original vector emblems: transparent, crisp at any display density. */
const paths: Record<string, [string, string]> = {
  물: ["#68bccc", "M16 3C13 9 6 14 6 21a10 10 0 0020 0C26 14 19 9 16 3Z M11 20c0 4 2 6 5 6"],
  불: ["#e69a68", "M18 2c2 9-6 10-1 16 3-2 4-5 4-7 10 12 5 19-5 19C5 30 1 21 9 12c-1 7 2 7 4 9-2-9 4-12 5-19Z"],
  바람: ["#96c0a3", "M3 12h18c9 0 9-10 2-9 M3 18h24 M6 24h13c8 0 7 8 0 6"],
  번개: ["#b6a0d6", "M19 2 5 18h10l-2 12L28 12H18Z"],
  얼음: ["#9ccad8", "M16 2v28 M4 9l24 14 M4 23 28 9 M11 5l5 4 5-4 M11 27l5-4 5 4 M3 15l6-2-1-6 M24 25l-1-6 6-2"],
  자연: ["#91ac68", "M28 3C11 2 1 11 7 23c11 8 23-3 21-20Z M5 29 24 8 M12 21v-7 M17 16h7"],
  conch: ["#72b9bb", "M27 14c0-14-24-13-24 2 0 8 10 12 16 7l8 5-1-10c-1-8-13-9-15-2-2 6 7 7 7 1 0-3-4-3-4-1 M4 24l6 5"],
  shell: ["#d9b364", "M3 21C-1 4 29-1 30 18l-8 10H11Z M16 27V7 M12 25 7 11 M21 25l5-14"],
  "summer-tonic": ["#e9ac76", "M11 3h10v6l5 6v12H6V15l5-6Z M7 18h18 M12 5h8 M12 24h8"],
  "cleansing-salt": ["#a3c1cc", "M12 3h8v6l6 5v15H6V14l6-5Z M7 19h18 M15 23h2 M20 25h1 M11 26h1"],
  shellWand: ["#75b4b3", "M8 29 19 13 M14 12c-8-11 6-15 12-9 6 7-2 14-9 10 M18 6l4 3"],
  driftSpear: ["#bb996d", "M4 29 22 9 M18 11l3-9 9-1-1 9-9 3 M6 24l3 3"],
  coralFlute: ["#ce9483", "M6 29 23 2l6 4-17 25Z M15 20l2-3 M19 14l2-3 M22 8l2-3"],
  palmBow: ["#8da46b", "M9 2c27 4 27 24 0 28l5-14Z M10 3l4 13-4 13 M3 16h25 M24 12l5 4-5 4"],
  sunblade: ["#dfb970", "M11 20 25 2l5 3-14 18Z M7 17l12 10 M5 30l7-9 M6 26l3 3 M3 9h6 M6 6v6"],
  moonstaff: ["#aca4c9", "M5 30 20 12 M27 2c-9-3-15 7-7 12 7 4 12-4 9-8-2 6-11 4-7-2Z M9 23l3 3"],
};
export function ArtIcon({ id, className = "" }: { id: string; className?: string }) {
  const art = paths[id];
  if (!art) return null;
  return <svg className={`art-icon ${className}`} viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d={art[1]} fill={`${art[0]}55`} stroke={art[0]} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

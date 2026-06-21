export function formatMist(mist: bigint): string {
  if (mist === 0n) return "0";
  const sui = Number(mist) / 1_000_000_000;
  if (sui >= 0.01) return `${sui.toFixed(3)}`;
  const micro = Number(mist) / 1_000;
  return `${micro.toFixed(0)}K`;
}

export function shortAddr(address: string, head = 6, tail = 4): string {
  return `${address.slice(0, head)}...${address.slice(-tail)}`;
}

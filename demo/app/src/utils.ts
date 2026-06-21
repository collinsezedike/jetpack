export function formatMist(mist: bigint): string {
  if (mist === 0n) return "0 SUI";
  const sui = Number(mist) / 1_000_000_000;
  return `${sui.toFixed(3)} SUI`;
}

export function shortAddr(address: string, head = 6, tail = 4): string {
  return `${address.slice(0, head)}...${address.slice(-tail)}`;
}

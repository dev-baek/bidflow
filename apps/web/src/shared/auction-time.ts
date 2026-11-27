export function remainingTime(endsAt: number, now: number): string | undefined {
  if (!Number.isFinite(endsAt)) return undefined;
  if (endsAt <= now) return "마감 시각 지남";
  const minutes = Math.floor((endsAt - now) / 60_000);
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}일 ${Math.floor(minutes / 60) % 24}시간`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
  return minutes > 0 ? `${minutes}분` : "1분 미만";
}

import { useState } from "react";

export function AuctionPhoto({ src, alt }: Readonly<{ src?: string; alt: string }>) {
  const [failed, setFailed] = useState<string>();
  return <div className="auction-photo">
    {src && failed !== src
      ? <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)} />
      : <span>사진 없음</span>}
  </div>;
}

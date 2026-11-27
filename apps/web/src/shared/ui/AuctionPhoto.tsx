import { useState } from "react";

export function AuctionPhoto({ src, alt, failureText = "사진 없음" }: Readonly<{ src?: string; alt: string; failureText?: string }>) {
  const [failed, setFailed] = useState<string>();
  return <div className="auction-photo">
    {src && failed !== src
      ? <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)} />
      : <span>{src ? failureText : "사진 없음"}</span>}
  </div>;
}

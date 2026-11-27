import { Link } from "react-router-dom";

export function BrandLink() {
  return <Link className="brand-link" to="/" aria-label="BidFlow 홈">
    <span className="brand-link__mark" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m14 13-7 7m1-13 6 6m-3-9 6 6m-8-2 3-3m1 7 3-3m0 11h5" />
      </svg>
    </span>
    BidFlow
  </Link>;
}

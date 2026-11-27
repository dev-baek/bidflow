import { Link, NavLink, Outlet, useLocation, useMatch } from "react-router-dom";
import { useAuth } from "../features/auth/auth-context";
import { BrandLink } from "../shared/ui/BrandLink";
import { Button } from "../shared/ui/Button";
import { MarketplaceSearch } from "../features/listing-search/MarketplaceSearch";

export function SiteLayout() {
  const { state, signOut } = useAuth();
  const auctionDetail = useMatch("/auctions/:auctionId") !== null;
  const home = useMatch("/") !== null;
  const listingSearch = useMatch("/listings") !== null;
  const { key } = useLocation();
  return <>
    <header className="site-header">
      <div className="ui-page site-header__inner">
        <BrandLink />
        {!home && !listingSearch && <MarketplaceSearch key={key} placement="header" />}
        <nav aria-label="주 메뉴" className="site-header__nav">
          <NavLink to="/" end>홈</NavLink>
          {auctionDetail ? <Link to="/listings" aria-current="location">경매</Link> : <NavLink to="/listings" end>경매</NavLink>}
          <NavLink to="/listings/new" end>상품 등록</NavLink>
        </nav>
        {state.mode === "AUTHENTICATED"
          ? <Button variant="ghost" onClick={signOut}>로그아웃</Button>
          : <Link className="site-header__login" to="/login">로그인</Link>}
      </div>
    </header>
    <Outlet />
  </>;
}

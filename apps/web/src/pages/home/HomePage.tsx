import { Link } from "react-router-dom";
import { useAuth } from "../../features/auth/auth-context";
import { PageLayout } from "../../shared/ui/PageLayout";
import { MarketplaceSearch } from "../../features/listing-search/MarketplaceSearch";
import { searchCategories } from "../../features/listing-search/search-state";

const examples: Record<keyof typeof searchCategories, string> = {
  DIGITAL: "카메라, 컴퓨터, 가전",
  FASHION: "의류, 신발, 가방",
  HOBBY: "피규어, 음반, 수집품",
  LIVING: "가구, 인테리어, 생활용품",
};

export function HomePage() {
  const { state } = useAuth();
  return <PageLayout>
    <div className="market-home">
      <section className="market-home__search" aria-labelledby="home-search-title">
        <h1 id="home-search-title">경매 상품 찾기</h1>
        <MarketplaceSearch placement="home" />
      </section>
      <nav className="market-home__categories" aria-labelledby="home-categories-title">
        <div className="market-home__section-title">
          <h2 id="home-categories-title">카테고리</h2>
          <Link className="ui-button ui-button--ghost ui-button--md" to="/listings?sort=RELEVANCE">경매 둘러보기</Link>
        </div>
        <ul role="list">
          {Object.entries(searchCategories).map(([id, label]) => <li key={id}>
            <Link to={`/listings?${new URLSearchParams({ categoryId: id, sort: "RELEVANCE" })}`}
              aria-labelledby={`category-title-${id}`} aria-describedby={`category-description-${id}`}>
              <strong id={`category-title-${id}`}>{label}</strong><span aria-hidden="true">→</span>
              <small id={`category-description-${id}`}>{examples[id as keyof typeof examples]}</small>
            </Link>
          </li>)}
        </ul>
      </nav>
      <section className="market-home__selling" aria-labelledby="home-selling-title">
        <div>
          <h2 id="home-selling-title">판매할 상품이 있나요?</h2>
          {state.mode === "AUTHENTICATED" && <p>
            {state.provider === "LOCAL" ? <><strong>{state.subject}</strong>으로 로그인했습니다.</> : "로그인했습니다."}
          </p>}
        </div>
        <Link className="ui-button ui-button--secondary ui-button--md" to="/listings/new">상품 등록하기</Link>
      </section>
    </div>
  </PageLayout>;
}

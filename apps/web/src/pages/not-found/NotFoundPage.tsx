import { Link } from "react-router-dom";
import { ErrorPage } from "../../shared/ui/ErrorPage";

export function NotFoundPage() {
  return <ErrorPage label="404" title="페이지를 찾을 수 없습니다">
    <p className="error-panel__hint">주소를 다시 확인하거나 경매 목록에서 원하는 상품을 찾아보세요.</p>
    <div className="error-panel__actions">
      <Link className="ui-button ui-button--primary ui-button--md" to="/listings">경매 둘러보기</Link>
      <Link className="ui-button ui-button--secondary ui-button--md" to="/">BidFlow 홈으로 돌아가기</Link>
    </div>
  </ErrorPage>;
}

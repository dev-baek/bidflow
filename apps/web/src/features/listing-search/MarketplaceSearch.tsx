import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../shared/ui/Button";
import { Field } from "../../shared/ui/Field";
import { readSearchFilters, searchParamsFrom } from "./search-state";

export function MarketplaceSearch({ placement }: Readonly<{ placement: "home" | "header" }>) {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const header = placement === "header";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = searchParamsFrom({ ...readSearchFilters(new URLSearchParams()), keyword });
    if (!result.params) {
      setError(result.error);
      input.current?.focus();
      return;
    }
    void navigate(`/listings?${result.params.toString()}`);
  }

  return <form role="search" aria-label={header ? "전체 경매 검색" : "홈 상품 검색"}
    className={header ? "marketplace-entry site-header__search" : "marketplace-entry"} onSubmit={submit}>
    <Field id={`${placement}-listing-keyword`} label={header ? "전체 경매 검색어" : "검색어"} error={error}>
      {control => <input {...control} ref={input} type="search" placeholder="상품명을 입력하세요" value={keyword} onChange={event => {
        setKeyword(event.target.value);
        setError(undefined);
      }} />}
    </Field>
    <Button type="submit">검색</Button>
  </form>;
}

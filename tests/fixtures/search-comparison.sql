-- #63: PostgreSQL 단순 조회와 OpenSearch 검색을 같은 공개 상품 Fixture에서 비교한다.
-- 이 데이터는 seller_id로 격리되며 재실행 전에 이전 Fixture를 제거한다.
delete from auction
where seller_id = 'benchmark-seller';

delete from product
where seller_id = 'benchmark-seller';

insert into product (
    product_id, seller_id, title, description, category_id, condition_grade, status, version, created_at, updated_at
)
select
    ('00000000-0000-0000-0000-' || lpad(value::text, 12, '0'))::uuid,
    'benchmark-seller',
    case when value <= 50 then 'Camera benchmark ' || value else 'Chair benchmark ' || value end,
    '검색 비교를 위한 공개 상품 Fixture 설명입니다.',
    case when value <= 50 then 'DIGITAL' else 'LIVING' end,
    'GOOD',
    'PUBLISHED',
    1,
    now(),
    now()
from generate_series(1, 100) as value;

insert into auction (
    auction_id, product_id, seller_id, status, starting_price, current_price, starts_at, ends_at, version, created_at, updated_at
)
select
    ('00000000-0000-0000-0001-' || lpad(value::text, 12, '0'))::uuid,
    ('00000000-0000-0000-0000-' || lpad(value::text, 12, '0'))::uuid,
    'benchmark-seller',
    'ACTIVE',
    10000,
    10000 + value,
    now() - interval '1 hour',
    now() + interval '1 day' + value * interval '1 minute',
    1,
    now(),
    now()
from generate_series(1, 100) as value;

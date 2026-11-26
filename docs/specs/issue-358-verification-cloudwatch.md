# [Issue #358] 검증 환경 CloudWatch 대시보드·알람 사양

- 작업: [#358 로컬 구현·모의 검증](https://github.com/dev-baek/bidflow/issues/358), 상위 [#92 관측 구성](https://github.com/dev-baek/bidflow/issues/92).
- 선행: [로그·지표·추적 사양](issue-018-observability.md). 이 문서는 그중 단기 검증 창에서 실제로 수집할 항목만 확정한다.
- 실계정 알람 전이·수신은 [#359](https://github.com/dev-baek/bidflow/issues/359), 배포와 삭제는 [#356](https://github.com/dev-baek/bidflow/issues/356)·[#357](https://github.com/dev-baek/bidflow/issues/357)에서 승인 후 수행한다.

## S. 운영 화면과 대응

한 화면에서 입찰 접수·정산 결과, ALB·애플리케이션의 5xx, 입찰 정산 Consumer 적체를 따로 본다. 정상적인 입찰 거절은 운영 오류가 아니다. 원인 추적이 필요하면 권한이 있는 운영자만 로그에서 `correlationId`로 관련 이벤트를 찾는다. 데이터가 없는 구간은 정상이나 0으로 해석하지 않는다.

| 알람 | 단기 검증용 초깃값 | 먼저 확인할 것 |
|---|---|---|
| 애플리케이션 HTTP 5xx | 60초 Sum ≥ 1, 1개 구간 | 대상 상태와 API 로그. ALB 자체 5xx는 별도 대시보드 시계열에서 확인 |
| 입찰 정산 적체 | 60초 Maximum > 0, 3개 연속 구간 | `bid-settlement` 그룹 상태, 소비·커밋 재개 여부 |

두 알람 모두 `treat_missing_data = "missing"`을 사용한다. 지속적으로 데이터가 없으면 `INSUFFICIENT_DATA`를 검증 실패 또는 보류로 기록한다. 적체 알람은 부하 종료를 스스로 감지하지 않으므로, 부하 종료 뒤 60초 이내 회복 기준은 #359에서 별도로 측정한다. 임계값은 운영 SLO가 아니다.

## D. 지표 계약

| 대시보드 | 원천 및 지표 | 단위·차원·통계 |
|---|---|---|
| 접수 | 검증 로그의 `event=bid.request.received`, `outcome=RECEIVED` → `BidRequestsReceived` | `BidFlow/Verification`, Count, 차원 없음, 60초 Sum |
| 정산 승인·거절 | `event=bid.settled`에서 `outcome=ACCEPTED` → `BidSettlementsAccepted`; `BID_TOO_LOW`, `SELF_BID`, `AUCTION_ENDED`, `AUCTION_NOT_STARTED`, `NOT_ACTIVE`만 → `BidSettlementsRejected` | 같은 namespace, Count, 차원 없음, 60초 Sum |
| 요청과 오류 | `AWS/ApplicationELB`: `RequestCount`, `HTTPCode_Target_5XX_Count`, `HTTPCode_ELB_5XX_Count` | Count, `LoadBalancer` ARN suffix, 60초 Sum. 입찰 API만이 아닌 ALB 단위 |
| 정산 적체 | `AWS/Kafka`: `SumOffsetLag` | 미소비 offset 수, `Cluster Name`·`Consumer Group=bid-settlement`·`Topic=bid-command`, 60초 Maximum. 파티션 합계는 MSK가 계산하므로 CloudWatch에서 그 합계를 다시 합산하지 않음 |

- 입찰 커스텀 지표는 매칭 로그당 1을 게시한다. 이 값은 접수·결과 추이이며, 재요청·로그 중복·유실이 있을 수 있어 고유 입찰 수나 원장 커밋 증거로 쓰지 않는다. 다른 이벤트, 누락·미정의 `outcome`, 일반 텍스트 로그는 집계하지 않는다.
- 로그가 도착했지만 매칭이 없는 분만 기본값 0이다. 로그가 수집되지 않은 분은 공백으로 남긴다. MSK가 lag를 게시하지 않는 경우도 공백을 유지한다.
- 검증 환경 하나만 사용한다. 식별자·금액·오류 메시지는 지표 차원이나 알림 본문에 넣지 않는다. DLT, Outbox, Redis, P95와 EC2 메모리는 이 구현이 수집한다고 가정하지 않는다.

## B. 연결과 보존

1. Terraform이 검증 전용 Standard 로그 그룹을 만들고 7일 보존을 설정한다. 최초 실행 창의 기본값은 정리 시 이 그룹도 삭제하는 것이다. 승인된 증적은 자격 증명·요청 값·로그 원문 없이 시각, 상태, 집계 결과만 남긴다.
2. 검증 EC2는 기존 Docker 실행에 `awslogs`를 적용한다. 그룹 자동 생성은 끄고, 인스턴스마다 고유한 스트림을 사용한다. EC2 역할에는 해당 그룹 스트림의 `logs:CreateLogStream`, `logs:PutLogEvents`만 추가한다. 런타임이 비밀값, 전체 요청·Kafka payload, 입찰가를 출력하지 않는지 전송 경계에서 재확인한다. 새 수집기나 SDK는 추가하지 않는다.
3. 로그 전송 지연으로 입찰 처리를 막지 않도록 Docker의 버퍼링 모드를 명시한다. 버퍼가 가득 찼을 때 유실될 수 있고 컨테이너 시작 시 로그 드라이버 초기화 실패도 가능하므로, 알람의 OK 상태만으로 수집이나 시스템 정상 여부를 판단하지 않는다.
4. 검증 대시보드와 알람은 Terraform으로 관리한다. MSK 비활성화 시 lag 위젯·알람을 만들지 않는다. 승인된 테스트 채널이 없으면 알람 액션을 설정하지 않는다. 다른 환경과 로컬 Docker 로그 경로는 그대로 둔다.

## T. 확인 순서

- 로컬: 기존 Terraform AWS mock에 검증 기본값·옵션 조합을 추가한다. 대시보드와 알람의 metric 이름/차원/통계, 로그 그룹 보존, 스트림 범위 IAM, 알림 연결 유무, MSK 비활성화와 누락 데이터 처리 설정을 확인한다.
- 로컬: 실제 구조화 이벤트 계약에 맞춘 가짜 JSON으로 접수·승인·정상 거절 및 무관한 이벤트·누락·미정의 결과를 대조한다. 템플릿 렌더링 결과의 Docker 옵션과 쉘 구문을 확인한다. 모의 테스트는 AWS 필터 파서나 로그 전송, 알람 전이를 검증하지 않는다.
- #359: 승인된 합성 입찰과 오류 입력으로 지표 표시, 알람 전이·수신, lag 회복을 확인한다. 로그·지표가 비어 있거나 채널이 확인되지 않으면 통과시키지 않는다.

참고: [Docker awslogs](https://docs.docker.com/engine/logging/drivers/awslogs/), [CloudWatch 로그 필터](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/MonitoringLogData.html), [ALB 지표](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-cloudwatch-metrics.html), [MSK Serverless 지표](https://docs.aws.amazon.com/msk/latest/developerguide/serverless-monitoring.html), [알람의 누락 데이터](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarms-and-missing-data.html).

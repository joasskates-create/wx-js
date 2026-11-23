# 多通道微信扫码支付 MVP

这是一个可运行的微信支付平台骨架，支持多个独立主体、服务号 AppID、商户号、V2 Native 扫码和公众号 JSAPI 支付。

## 启动

```powershell
npm install
npm run dev
```

生产环境可以先复制 `.env.example` 为 `.env`，再使用 `docker compose up -d --build` 启动。容器使用非 root 用户运行，SQLite 数据保存在 `payment-data` 卷中，容器就绪检查地址为 `/ready`，存活检查地址为 `/health`。当前部署基线是单实例 SQLite；扩展为多实例时，应先迁移共享数据库并强制配置 `REDIS_URL`，不要让多个容器直接共享同一个 SQLite 文件。

数据库备份可执行 `npm run backup:db -- ./backups`；恢复时必须显式指定 `--force`，例如 `npm run restore:db -- ./backups/payments-xxx.db ./data/payments.db --force`。恢复前应先停止应用进程。

浏览器打开 http://localhost:3000。默认使用 `MOCK_PAYMENT=true`，可以生成二维码并点击“模拟支付成功”验证订单状态流转。

平台后台地址：`http://localhost:3000/admin`。后台现在使用左侧菜单，包含首页、主体、AppID、商户号、通道、订单、异常、退款、回调、对账、监控和审计入口。码商独立工作台地址：`http://localhost:3000/merchant`，使用码商编码和创建时生成的 API Key 登录。

## 已实现

- 主体、服务号 AppID、商户号、AppID-商户号绑定和通道数据模型
- 通道权重路由
- 固定金额 Native 二维码下单接口
- 微信 Native 与挂码模式独立路由：Native 只走微信统一下单，挂码只分配已导入二维码
- 公众号 OAuth 授权、一次性 oauth token 和 JSAPI V2 下单
- 收银台支持 Native 扫码与公众号支付方式切换
- API 幂等键：`merchantId + clientRequestNo`
- 订单状态和支付尝试记录
- 统一回调入口
- 微信支付 V2 Native 请求签名和 XML 回调验签
- 简易收银台页面
- 后台主体/AppID/商户号关系概览、通道状态切换和订单列表
- 左侧菜单式运营后台
- 订单查单、关单、退款记录和回调记录接口
- 路由规则管理、金额区间匹配和规则状态切换
- 路由规则版本留痕与回滚；候选通道按健康度动态降权，预占或微信下单失败时自动切换备用通道
- 路由容量在预占事务内再次校验并发、日金额和日订单上限，避免并发请求绕过限制
- 通道近 24 小时订单成功率监控
- 通道、路由、订单和退款操作审计日志
- 本地对账批次：按日期和通道汇总订单、退款，并标记待查单与本地异常
- 外部流水导入：按商户订单号/微信交易号、金额、状态和退款金额进行匹配，输出外部独有、本地独有和金额/状态差异
- 管理员登录与角色权限：支持 SUPER_ADMIN、OPERATIONS、FINANCE、CHANNEL_ADMIN、AUDITOR
- 微信账单 JSON 导入和按通道手动对账入口
- 可配置的定时对账任务，支持重复保护、空账单和失败审计
- 预生产验收脚本覆盖下单幂等、支付成功、退款幂等和超额退款拦截
- 管理后台提供订单/额度/退款/流水一致性巡检和查单、退款恢复、回调重试入口
- 支付结果自动恢复：对未明确状态订单查单；到期且微信侧确认未支付时自动调用关单并转为 CLOSED，查询失败继续保留 UNKNOWN
- 异常订单闭环：后台支持单笔查单、确认关单、标记状态未知，所有自动与人工动作写入订单异常处理记录并在详情页展示
- 退款状态自动恢复：对 PROCESSING/PENDING 退款定时查单并更新最终状态
- 通道健康度与熔断：连续失败自动 OPEN，恢复后允许 HALF_OPEN 探测
- 回调失败重试与死信：指数退避、最多 8 次、后台可查看任务状态
- 码商接入管理：生成一次性 API Key，码商列表提供支付开关、授信额度余额展示和通道授权；编辑码商时可审计增加或扣减授信额度
- 码商独立工作台：独立会话、订单查询、结算报表、结算单确认和 API Key 轮换
- 接入商户租户接口：每个接入商户独立 API Key，只能查询和导出自身 `clientMerchantId` 下的订单；平台后台支持重置该 Key
- 码商通道白名单：平台管理员为每个码商配置可使用的支付通道，码商下单只能命中白名单通道
- 退款审批闭环：码商只提交退款申请，平台管理员审核后才调用原支付通道，审批和通道结果均可追踪
- 码商经营日报：按日期、通道统计订单、成功率、交易额、退款和净额，并支持 CSV 导出
- 码商业务回调：订单/退款状态变更进入可靠投递队列，HMAC-SHA256 签名、失败重试和死信记录
- 码商资金与额度：平台可手动增加/扣减码商收款额度，订单成功后扣减额度余额；同时独立展示可结算余额、待结算金额、冻结金额、账务流水、单笔/单日/待结算额度和预警阈值
- 生产化加固：回调密钥可用 `DATA_ENCRYPTION_KEY` 加密存储，生产模式就绪检查会阻止未配置加密密钥的实例接流量
- 结算单生命周期：DRAFT、CONFIRMED、PAID、VOID，平台后台可生成、审核和标记打款
- 可选的前一日结算单自动生成任务，支持分布式锁和重复执行保护
- 主体/AppID/商户号/通道配置校验：限制同主体绑定，停用的 AppID、商户号和熔断通道不会参与路由
- 订单状态机和下单/退款幂等保护，拒绝非法状态回退和重复退款
- 公开接口脱敏：公共通道列表不返回 AppID、商户号和凭证引用；订单详情在未认证时只返回收银台所需字段
- 核心数据流自动化测试：主体绑定、结算金额、状态流转和通道熔断
- 数据库备份和恢复脚本，恢复操作要求显式 `--force`
- 可选 AES-256-GCM 加密备份，避免备份文件直接暴露业务数据
- OpenAPI 接口契约文件，可导入 Swagger UI 或 Postman

## 主要接口

```text
GET  /health
GET  /ready
GET  /metrics
GET  /metrics/prometheus
GET  /api/v1/channels
GET  /api/v1/admin/channels
GET  /api/v1/admin/channels/:id/preflight
GET  /api/v1/admin/channels/:id/detail
PUT  /api/v1/admin/channels/:id/platform-merchants
POST /api/v1/admin/routing/preview
POST /api/v1/channels
POST /api/v1/orders
GET  /api/v1/orders/:id
POST /api/v1/orders/:id/simulate-paid   # 仅 MOCK_PAYMENT=true
POST /api/v1/orders/:id/query
POST /api/v1/orders/:id/close
POST /api/v1/orders/:id/refunds
POST /webhooks/wechatpay/:channelId
POST /webhooks/wechatpay/:channelId/refund
GET  /api/v1/admin/routing-rules
POST /api/v1/admin/routing-rules
GET  /api/v1/admin/monitoring
GET  /api/v1/admin/audit
GET  /api/v1/admin/reconciliation/runs
GET  /api/v1/admin/reconciliation/runs/:id
POST /api/v1/admin/reconciliation/runs
POST /api/v1/admin/reconciliation/runs/:id/bill
POST /api/v1/admin/reconciliation/download
POST /api/v1/admin/subjects
POST /api/v1/admin/apps
POST /api/v1/admin/merchants
POST /api/v1/admin/channels
PATCH /api/v1/admin/channels/:id
PATCH /api/v1/admin/apps/:id/status
PATCH /api/v1/admin/merchants/:id/status
PATCH /api/v1/admin/routing-rules/:id
GET  /api/v1/admin/channel-health
POST /api/v1/admin/channel-health/:id/reset
GET  /api/v1/admin/data-consistency
POST /api/v1/admin/payment-recovery/run
POST /api/v1/admin/refund-recovery/run
GET  /api/v1/admin/callback-tasks
POST /api/v1/admin/callback-retry/run
GET  /api/v1/admin/settlement/report?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&channelId=...
GET  /api/v1/admin/platform-merchants
GET  /api/v1/admin/platform-merchants/:id
GET  /api/v1/admin/platform-merchants/:id/channels
PUT  /api/v1/admin/platform-merchants/:id/channels
POST /api/v1/admin/platform-merchants
PATCH /api/v1/admin/platform-merchants/:id/status
PATCH /api/v1/admin/platform-merchants/:id/profile
POST /api/v1/admin/platform-merchants/:id/rotate-key
POST /api/v1/admin/client-merchants/:id/rotate-key
POST /api/v1/admin/orders/batch-query
GET  /api/v1/admin/orders/:id/detail
GET  /api/v1/admin/orders/:id/exception-actions
POST /api/v1/admin/orders/:id/exception-action （QUERY/CLOSE/MARK_UNKNOWN，单笔异常处理并留痕）
GET  /api/v1/admin/orders/export
GET  /api/v1/admin/exceptions
GET  /api/v1/admin/routing-rules/:id/versions
POST /api/v1/admin/routing-rules/:id/versions/:version/rollback
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me
POST /api/v1/merchant/auth/login （账号密码；旧版 code + API Key 仍兼容）
POST /api/v1/merchant/auth/logout
GET  /api/v1/merchant/auth/me
GET  /api/v1/merchant/overview
GET  /api/v1/merchant/sub-merchants/stats （码商授权通道下的商户号收款概览）
GET  /api/v1/merchant/sub-merchants/:merchantId （下级商户号订单详情）
GET  /api/v1/merchant/sub-merchants/:merchantId/export
GET  /api/v1/merchant/account
GET  /api/v1/merchant/account/ledger
GET  /api/v1/merchant/account/credit-ledger
GET  /api/v1/merchant/account/alerts
GET  /api/v1/merchant/channels
GET  /api/v1/merchant/channels/stats
GET  /api/v1/merchant/orders
GET  /api/v1/merchant/orders/:id
GET  /api/v1/merchant/refunds
GET  /api/v1/merchant/refunds/export
GET  /api/v1/merchant/settlement/report
GET  /api/v1/merchant/settlements
GET  /api/v1/merchant/settlements/:id
GET  /api/v1/client/auth/me （X-Client-Merchant-Key）
GET  /api/v1/client/overview
GET  /api/v1/client/orders
GET  /api/v1/client/orders/:id
GET  /api/v1/client/orders/export
GET  /api/v1/merchant/orders/export
GET  /api/v1/merchant/settlements/export
POST /api/v1/merchant/settlements/:id/confirm
POST /api/v1/merchant/orders/:id/refunds
GET  /api/v1/merchant/report/operations
GET  /api/v1/merchant/report/operations/export
GET  /api/v1/merchant/webhook （只读，回调由主后台配置）
GET  /api/v1/merchant/webhook/deliveries
POST /api/v1/admin/refunds/:refundNo/approve
POST /api/v1/admin/refunds/:refundNo/reject
GET  /api/v1/admin/platform-merchants/:id/webhook
PUT  /api/v1/admin/platform-merchants/:id/webhook
GET  /api/v1/admin/platform-merchants/:id/risk
PATCH /api/v1/admin/platform-merchants/:id/risk
GET  /api/v1/admin/platform-merchants/:id/account
GET  /api/v1/admin/platform-merchants/:id/account/ledger
GET  /api/v1/admin/platform-merchants/:id/account/credit-ledger
GET  /api/v1/admin/platform-merchants/:id/account/alerts
PATCH /api/v1/admin/platform-merchants/:id/quota
PATCH /api/v1/admin/platform-merchants/:id/credit
GET  /api/v1/admin/merchant-webhook-deliveries
POST /api/v1/admin/merchant-webhook-deliveries/:id/retry
POST /api/v1/admin/platform-merchants/:id/webhook/test
POST /api/v1/admin/platform-merchants/:id/users
PATCH /api/v1/admin/platform-merchants/:id/users/:userId/password
POST /api/v1/admin/reconciliation/items/:itemId/resolve
GET  /api/v1/admin/settlements
POST /api/v1/admin/settlements/auto-generate
GET  /api/v1/admin/settlements/export
POST /api/v1/admin/settlements
PATCH /api/v1/admin/settlements/:id/status
```

外部流水导入格式示例：

```json
{
  "items": [
    {
      "channelId": "demo-channel",
      "outTradeNo": "商户订单号",
      "transactionId": "微信交易号",
      "amount": 100,
      "tradeState": "SUCCESS",
      "refundAmount": 0
    }
  ]
}
```

退款接口支持请求体 `refundNo` 或请求头 `X-Idempotency-Key`，重复提交同一编号会返回原退款记录。码商接口只创建 `PENDING` 审批申请，平台审核通过后才会向通道发起退款；管理员直接发起的退款视为已审核。

通道上线前可调用预检接口确认主体绑定、AppID/商户号状态、回调路径和凭证状态；`POST /api/v1/admin/routing/preview` 可按金额预览实际命中的通道。退款状态由回调和定时查单共同推进，状态包括 `PENDING`、`PROCESSING`、`SUCCESS`、`CLOSED`、`ABNORMAL`。

## 接入真实微信支付

设置 `MOCK_PAYMENT=false`，并通过部署环境注入 `PAYMENT_CREDENTIALS_JSON`。V2 Native 基础收款只需要商户号和 APIv2 密钥。示例结构：

```json
{
  "mch-190000xxxx": {
    "mchid": "190000xxxx",
    "apiV2Key": "微信商户平台设置的 APIv2 密钥"
  }
}
```

新增商户号时可以同时勾选 Native 扫码和公众号支付。页面按支付方式选择 AppID，所属主体由 AppID 自动带出；两个支付方式同时启用时，所选 AppID 必须属于同一主体。Native 与公众号支付共用商户号、APIv2 密钥和回调配置；公众号支付只显示已补齐 AppSecret、OAuth 授权域名和 JSAPI 支付授权目录的服务号 AppID。AppSecret 通过 `DATA_ENCRYPTION_KEY` 单独加密保存，不会返回到浏览器。订单接口传入 `paymentMethod=JSAPI` 时，如果没有 oauth token，会返回授权地址；授权完成后使用一次性 token 继续下单。

订单接口默认使用 `collectionMode=NATIVE`，会调用微信 V2 Native 统一下单并生成动态 `code_url`；只有明确传入 `collectionMode=QR` 时才会进入挂码模式。Native 回调地址由通道和商户号自动生成，系统接收 V2 XML 通知、验签、幂等更新订单并由恢复任务查单兜底。

开发环境在 `MOCK_PAYMENT=true` 且 `NODE_ENV` 不是 `production` 时，JSAPI 下单返回的授权地址会进入 `/api/v1/dev/wechat/oauth/mock`，生成一次性模拟 OpenID 后回到公众号收银台。该入口仅用于本地验证页面、OAuth 状态和 JSAPI 下单流程，生产环境不会启用；真实联调仍需在微信内打开公网 HTTPS 地址。

当前页面支持把微信账单转换成 JSON 后导入；V2 基础收款模式不提供需要证书的退款和账单下载能力，生产环境仍应配置密钥轮换、限流策略和更细的主体级数据权限。

开启管理员认证：设置 `ADMIN_AUTH_ENABLED=true`、`ADMIN_USERNAME` 和 `ADMIN_PASSWORD`。开启后，后台 API 需要登录 Cookie；开发环境默认关闭认证。生产环境还必须设置 `NODE_ENV=production`、`PUBLIC_BASE_URL=https://...`、`SECURE_COOKIES=true`、长度不少于 32 字节的 `DATA_ENCRYPTION_KEY`，并关闭 `MOCK_PAYMENT`。配置不完整时进程会拒绝启动，`GET /ready` 会返回具体的 `issues`。开启定时对账：设置 `RECONCILIATION_ENABLED=true`，任务会按北京时间处理前一天的所有 ACTIVE 通道，间隔由 `RECONCILIATION_INTERVAL_MINUTES` 控制。

开启自动结算单：设置 `SETTLEMENT_AUTO_ENABLED=true`，任务会按北京时间为 ACTIVE 码商生成前一日 DRAFT 结算单，间隔由 `SETTLEMENT_AUTO_INTERVAL_MINUTES` 控制。

码商回调由平台主后台统一配置 URL、密钥和启用状态，码商后台仅查看投递记录。码商账号角色为 OWNER、OPERATOR、FINANCE、VIEWER：通道配置由 OWNER/OPERATOR 操作，退款和结算确认由 OWNER/FINANCE 操作，VIEWER 只读。投递请求使用 `X-Merchant-Event`、`X-Merchant-Delivery`、`X-Merchant-Timestamp` 和 `X-Merchant-Signature`，签名原文为 `timestamp + "\n" + rawBody`，算法为 HMAC-SHA256。回调失败按指数退避重试，最多 8 次并进入死信状态。

生产部署参考 `docker-compose.production.yml`、`deploy/nginx.conf` 和 `docs/production-runbook.md`。当前运行时仍以 SQLite 为默认单实例数据库；PostgreSQL 迁移目标和约束记录在 `docs/postgres-migration.sql`，完成适配前不要直接横向扩容应用容器。

预生产验收可执行：`$env:E2E_ALLOW_MUTATION='true'; npm run preprod:e2e`、`npm run smoke`、`npm run fault:smoke`。SQLite 数据迁移到 PostgreSQL 可执行 `DATABASE_URL=... npm run migrate:postgres`；迁移完成并切换适配层前，请保持 `DB_ENGINE=sqlite`。

码商风控支持单笔金额、单日金额、单日订单数、待结算金额和待结算订单数限制；管理员可通过码商管理页面或额度接口调整，并可设置预警/临界比例。APIv2 密钥可通过管理员凭证接口加密保存和删除，生产环境必须配置 `DATA_ENCRYPTION_KEY`，并通过 HTTPS 调用凭证接口。

登录接口带有按 IP 的失败请求限流；生产 HTTPS 环境请设置 `SECURE_COOKIES=true`。`/metrics` 需要管理员权限，返回 JSON 指标；`/metrics/prometheus` 返回 Prometheus 文本格式，可由现有监控系统抓取。配置 `METRICS_TOKEN` 后，抓取端使用 `Authorization: Bearer <token>`，否则沿用管理员会话校验。启用 `MERCHANT_IP_ALLOWLIST` 后，签名码商请求还会校验来源 IP（逗号分隔）。

监控只提供站内指标和接口，不接入企业微信、钉钉等外部告警渠道。

备份默认生成 SQLite 文件；设置 `BACKUP_ENCRYPTION_KEY` 后，`npm run backup:db` 生成 AES-256-GCM 加密的 `.db.enc` 文件，恢复时必须在环境中提供同一个密钥并继续使用 `--force`。

支付恢复、回调重试分别由 `PAYMENT_RECOVERY_ENABLED`、`CALLBACK_RETRY_ENABLED` 控制；通道连续失败次数由 `CHANNEL_FAILURE_THRESHOLD` 控制。启用 `MERCHANT_API_AUTH_ENABLED` 后，创建订单必须携带 `X-Merchant-Key`，后台“码商管理”创建码商时返回一次性 API Key，请在创建后立即保存。启用 `MERCHANT_SIGNATURE_REQUIRED` 后，还必须携带 `X-Merchant-Code`、`X-Merchant-Timestamp`、`X-Merchant-Nonce` 和 `X-Merchant-Signature`，签名内容为 `timestamp + nonce + method + path + rawBody` 的 HMAC-SHA256，重复 nonce 会被拒绝。配置 `REDIS_URL` 后，支付恢复和回调重试任务使用 Redis 分布式锁；未配置时使用单进程锁。

## 接入商户管理

主后台新增“商户管理”模块，与“码商管理”分离。商户列表维护商户号、名称、登录账号、代理/分润、余额、冻结、预付款、待结算和提现手续费，并提供搜索、状态筛选、汇总统计、详情抽屉、余额调整、资金流水和码商绑定。

对应接口：

- GET/POST /api/v1/admin/client-merchants
- GET/PATCH /api/v1/admin/client-merchants/:id
- PATCH /api/v1/admin/client-merchants/:id/balance
- GET /api/v1/admin/client-merchants/:id/ledger
- GET/PUT /api/v1/admin/client-merchants/:id/code-merchants

订单请求可选传入 clientMerchantId。平台会校验接入商户处于启用状态，并校验该商户是否已授权对应码商；订单表通过独立字段记录接入商户，避免和码商、微信商户号混用。

## 多码商通道路由（五阶段落地）

系统将“接入商户、码商、逻辑支付通道、微信商户号”拆成独立关系：一个逻辑通道可授权多个码商，一个码商可绑定多个微信商户号；订单先按路由规则筛选通道，再按码商策略、商户号金额区间、权重和健康状态选出最终收款商户号。订单会保存 `routeRuleId`、`routeSnapshot` 和 `routeSelectedAt`，回调、退款和对账都沿用这次分配结果。

通道预检会同时校验通道状态、AppID、回调路径、微信商户号、码商授权、码商名下商户号和通道绑定关系；只要没有可实际收款的最终商户号，该通道就不会进入路由候选。接口 `GET /api/v1/admin/channels/:id/preflight` 会返回 `issues`、`routingReady` 和可用目标数量，便于后台在启用前修复配置。

平台管理员可以使用以下接口维护关系和容量策略：

- `GET/PUT /api/v1/admin/platform-merchants/:id/wechat-merchants`：维护码商名下微信商户号及单笔金额、日限额、并发上限、轮询权重。
- `GET/PUT /api/v1/admin/channels/:id/platform-merchants`：授权码商使用逻辑通道。
- `GET/PUT /api/v1/admin/channels/:id/platform-merchants/policies`：维护码商在通道内的权重、并发、日限额和启停状态。
- `POST /api/v1/admin/routing/preview`：按金额预览规则、码商和微信商户号的最终候选，可选传 `channelId`、`clientMerchantId` 或 `platformMerchantId` 复现指定业务场景。
- `GET /api/v1/admin/orders/:id/route`：查看订单的路由分配快照和容量预占记录。
- `GET /api/v1/admin/settlements/:id/difference`：按订单汇总、退款流水和账务流水核对结算单，返回差异金额。

下单时会原子预占通道、码商和微信商户号容量；支付成功转为 `CONSUMED`，失败、关闭或超时释放为 `RELEASED`。路由分配日志保存在 `route_allocations`，容量预占保存在 `route_reservations`，后台数据一致性巡检会检查处理中订单缺少预占以及终态订单仍占用预占等问题。

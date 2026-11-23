# 生产化运行手册

## 数据库与部署

当前代码默认使用 SQLite，适合单实例或低并发部署。生产多实例部署前可先使用 `npm run migrate:postgres` 将现有 SQLite 表结构和数据导入 PostgreSQL（需要 `DATABASE_URL`），再切换数据库适配层。当前业务运行时仍会在 `DB_ENGINE=postgres` 时就绪失败，避免误把 SQLite 进程当成 PostgreSQL 多实例服务。Redis 只用于跨实例任务锁，不能替代数据库事务。

生产环境至少配置：

```env
NODE_ENV=production
PUBLIC_BASE_URL=https://pay.example.com
ADMIN_AUTH_ENABLED=true
SECURE_COOKIES=true
DATA_ENCRYPTION_KEY=<32字节以上随机密钥>
REDIS_URL=redis://redis:6379
MOCK_PAYMENT=false
```

`DATA_ENCRYPTION_KEY` 用于加密码商回调密钥。密钥丢失后无法解密已保存的回调密钥，轮换前必须完成旧密钥备份和重新配置。

生产进程会在启动时拒绝不安全配置：模拟支付、未开启管理员认证、非安全 Cookie、非 HTTPS 公网地址、弱管理员密码、短加密密钥，以及缺少支付凭证都会阻止启动。部署后先访问 `GET /ready`；返回 503 时，`issues` 字段会列出需要修复的配置项。APIv2 密钥通过 `PAYMENT_CREDENTIALS_JSON` 注入，或使用已配置 `DATA_ENCRYPTION_KEY` 的管理员凭证接口保存，密钥不应写入仓库。

## 回调与退款运维

当前支付适配器是 V2 Native 基础收款模式。收款、查单、关单和 XML 回调只需要 APIv2 密钥；微信退款和账单下载接口需要商户证书，因此在此模式下不启用。

Native 与挂码是两条独立链路：Native 订单必须使用 `collectionMode=NATIVE`，系统调用微信统一下单并把自动生成的通道回调地址作为 `notify_url`；挂码订单使用 `collectionMode=QR`，只分配后台导入的收款码，不调用微信 Native 下单。Native 回调入口要求公网 HTTPS，V2 XML 通知会验签、幂等落库，失败任务由回调重试和支付查单恢复任务处理。

- `GET /api/v1/admin/merchant-webhook-deliveries?status=DEAD` 查看死信。
- `POST /api/v1/admin/merchant-webhook-deliveries/:id/retry` 手工重新投递。
- 退款审核使用 `POST /api/v1/admin/refunds/:refundNo/approve` 或 `reject`。
- 审核通过使用原订单通道，通道结果仍由回调和恢复任务推进。

## 备份恢复演练

每日至少执行一次 `npm run backup:db`，保留 30 天；每月在隔离目录执行 `npm run restore:db -- <backup-file> <target-db> --force` 并访问 `/ready` 验证可启动。生产容器应挂载独立数据卷，禁止把数据库放在镜像层。

## PostgreSQL 迁移边界

业务 SQL 当前通过 `better-sqlite3` 执行。迁移到 PostgreSQL 时需将 SQLite 占位符、`INSERT OR IGNORE`、`datetime`、`strftime/substr` 聚合和 `PRAGMA` 替换为 PostgreSQL 方言，并把 `db.transaction` 替换为显式事务。迁移完成后应重新跑订单幂等、退款审批、回调重试和结算状态并发测试。

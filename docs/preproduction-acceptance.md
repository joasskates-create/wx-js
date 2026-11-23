# 预生产验收清单

执行前确认 `MOCK_PAYMENT=true` 或已经完成真实支付配置。模拟环境执行：

```powershell
$env:E2E_ALLOW_MUTATION='true'; npm run preprod:e2e
npm run smoke
npm run fault:smoke
```

必须通过：

- 重复 `clientRequestNo` 返回同一订单。
- 订单状态可以从待支付进入成功，回调重复投递不重复记账。
- 码商退款先进入待审核，审核后才进入通道处理。
- 回调失败进入重试队列，超过次数进入死信，并可手工重试。
- 对账差异可以标记为已处理或忽略，并留下审计记录。
- 结算单状态只能按 `DRAFT -> CONFIRMED -> PAID` 推进。
- 通道预检能识别 APIv2 密钥缺失和主体绑定错误。
- 重启服务后数据库、定时任务和回调队列仍可恢复。

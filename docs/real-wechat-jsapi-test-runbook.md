# 真实微信 JSAPI 联调清单

这份清单用于把公众号 JSAPI 收银台从本地 Mock 切换到公网真实联调。真实 AppSecret、APIv2 密钥和管理员密码只放在服务器环境变量或后台密钥配置中，不写入仓库。

## 1. 服务器和域名

1. 将域名解析到服务器公网 IP。
2. 使用证书部署 `deploy/certs/fullchain.pem` 和 `deploy/certs/privkey.pem`。
3. 使用 `docker-compose.production.yml` 启动；Nginx 会把 80 重定向到 443。
4. 确认以下地址能从公网访问：
   - `https://支付域名/health`
   - `https://支付域名/cashier/jsapi`
   - `https://支付域名/api/v1/wechat/oauth/callback`

## 2. 生产环境变量

```env
NODE_ENV=production
PUBLIC_BASE_URL=https://支付域名
MOCK_PAYMENT=false
ADMIN_AUTH_ENABLED=true
ADMIN_USERNAME=管理员账号
ADMIN_PASSWORD=长度不少于12位的强密码
SECURE_COOKIES=true
DATA_ENCRYPTION_KEY=长度不少于32位的随机密钥
REDIS_URL=redis://redis:6379
PAYMENT_CREDENTIALS_JSON={"mch-真实商户号":{"mchid":"真实商户号","apiV2Key":"32位APIv2密钥"}}
```

第一次启动生产环境时必须已经提供 `PAYMENT_CREDENTIALS_JSON`，或者把带有加密凭证文件的持久化数据卷一起迁移过来，否则 `/ready` 会拒绝就绪。

## 3. 公众号平台配置

在微信公众平台配置同一个服务号 AppID：

- AppID 类型必须是服务号。
- 网页授权域名填写支付域名的主机名，不带协议、端口和路径。
- JSAPI 支付授权目录填写收银台所在目录，例如 `https://支付域名/cashier/`。
- AppSecret 通过后台 AppID 配置保存，保存前确认 `DATA_ENCRYPTION_KEY` 已配置。

## 4. 微信商户平台配置

- 商户号与服务号 AppID 完成绑定。
- 开通 JSAPI 支付产品。
- APIv2 密钥为 32 位，并与系统商户号配置一致。
- 允许服务器访问 `api.mch.weixin.qq.com`。
- 保留系统生成的回调地址：
  `/webhooks/wechatpay/{channelId}/{mchid}`。

## 5. 后台配置顺序

1. 新增或编辑服务号 AppID，补齐 AppSecret、OAuth 域名、JSAPI 授权目录并启用。
2. 新增公众号支付商户号，选择该 AppID，填写真实商户号和 APIv2 密钥并启用。
3. 创建支付通道并绑定该商户号。
4. 在通道路由预览中使用测试金额确认能够命中该通道。
5. 打开通道预检，确认状态、主体、绑定、凭证、路由和回调均正常。

## 6. 联调顺序

1. 手机微信内打开 `/cashier/jsapi`。
2. 创建金额为 1 分的订单。
3. 确认跳转微信 OAuth 后返回收银台，页面能够调起微信支付。
4. 在微信支付完成后确认页面状态变为“支付成功”。
5. 在后台订单、回调中心确认订单状态、交易号和回调记录。
6. 若回调延迟，使用订单查单或支付恢复任务确认最终状态。

本地 `MOCK_PAYMENT=true` 时，系统只在非生产环境启用开发专用模拟 OAuth；生产环境始终使用微信官方 OAuth，不会启用模拟入口。

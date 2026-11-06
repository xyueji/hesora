# 激活服务器（离线发码）

Ed25519 离线激活码签发服务。零依赖（node:http）。

- `private.pem` — 私钥（与应用内嵌公钥 `src/shared/license.ts` 配对）。
  ⚠️ 当前私钥随仓库提交（开发期便利），**发布前必须移出仓库并妥善保管**。

## 启动

```bash
node server.js          # 默认端口 7799，可用 PORT 环境变量覆盖
```

## 接口

- `GET /health` → `{ ok: true }`
- `POST /api/activate`，body `{ "customer": "客户名", "expiresAt": "ISO 或省略", "machine": "可选" }`
  → `{ "code": "ZHJS1..." }`

## 命令行发码

```bash
node gen.js "客户名"        # 永久授权
node gen.js "客户名" 365    # 365 天后到期
```

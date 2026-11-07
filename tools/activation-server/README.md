# HESORA 激活服务

使用 Node.js 22.13 或更新的 22.x 版本。服务把兑换码哈希、客户、有效期和设备绑定写入 SQLite。

1. 在仓库外生成一对 Ed25519 密钥。把私钥文件的绝对路径填入服务端 `HESORA_LICENSE_PRIVATE_KEY_FILE`，将公钥 PEM 填入桌面端构建环境变量 `HESORA_LICENSE_PUBLIC_KEY`。桌面端填入 `HESORA_ACTIVATION_URL=https://授权域名/api/activate`。
2. 设置 `HESORA_LICENSE_DB` 为持久化数据库绝对路径。配置反向代理和 TLS，使用服务默认监听地址 `127.0.0.1:7799`，然后运行 `node server.js`。
3. 运行 `node gen.js --redeem "客户" [有效天数]`，将输出的兑换码通过私密渠道交给客户。留空表示长期授权。相同兑换码可在同一设备重试。
4. 换机时使用独立随机管理令牌 `HESORA_LICENSE_ADMIN_TOKEN`，以 `Authorization: Bearer <令牌>` 调用 `POST /api/unbind`，请求体为 `{"code":"兑换码"}`。旧设备已有的离线凭证仍按其有效期验签。

可用 `node gen.js --offline "客户" [有效天数]` 签发无需联网的凭证。此凭证不绑定设备。签名私钥始终保存在发行端。保管好激活数据库和密钥，并使用新生成的发行密钥构建正式客户端。

`GET /health` 用于反向代理健康检查。生产环境建议在代理层限制激活接口请求速率。

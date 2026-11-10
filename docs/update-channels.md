# 更新渠道配置（Gitee 优先 / GitHub 回退）

> 禾序进销存采用「提示式更新」：客户端每天最多检查一次更新，按渠道顺序拉取 `latest.json`
> 比对版本号，发现新版本弹出通知，点击后用系统浏览器打开**固定下载地址**。
> 联网仅用于更新检查；任何失败都静默跳过，不影响离线使用。
> 仓库：`xyueji/hesora`（Gitee 与 GitHub 同名），默认分支 `main`。

## 1. manifest 格式（`latest.json`）

字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `version` | string | 是 | 语义版本，必须匹配 `/^\d+(?:\.\d+){1,3}$/`，如 `1.0.1` / `1.2.3.4`；**每次发版必须递增** |
| `notes` | string | 否 | 更新说明，展示在通知里 |
| `url` | string | 否 | 安装包下载链接，**缺省时按第 2 节固定约定自动拼接**；显式给出时须过域名白名单 |
| `sha256` | string | 发布时必填 | 安装包 SHA-256，必须 64 位 hex；供 UI 展示/人工校验 |

示例（**推荐：省略 `url`，由客户端拼固定地址**）：

```json
{
  "version": "1.0.1",
  "notes": "修复若干问题",
  "sha256": "<64 位 hex，填安装包实际哈希>"
}
```

也可显式给 `url`（指向任一白名单域名）：

```json
{
  "version": "1.0.1",
  "notes": "修复若干问题",
  "url": "https://github.com/xyueji/hesora/releases/download/latest/hesora-inventory-setup.exe",
  "sha256": "<64 位 hex>"
}
```

校验规则（任一不满足即判定「该渠道失败」，不抛异常、继续尝试下一渠道）：

- `version` 必须是字符串且符合上面的正则；`notes` / `url` / `sha256` 若提供必须类型正确。
- `sha256` 若提供必须是 64 位 hex（大小写均可），否则该渠道失败。
- 显式 `url` 与拼接出的固定地址都必须是 `https:`、不含 username/password、主机在白名单内。
- manifest 地址本身也必须是 `https:`、无凭据；`fetch` 使用 `redirect: 'follow'` 与
  `AbortSignal.timeout(10000)`（每渠道 10s 超时）。**必须允许跟随重定向**：Gitee 的
  `/raw/main/latest.json` 会 302 到 `raw.giteeusercontent.com`（带一次性签名 query），
  若用 `redirect: 'error'` 会让 Gitee 渠道每次抛异常并回退 GitHub，令「Gitee 优先」失效。
  manifest 只解析为 JSON、不执行，目标 URL 由内置/env 提供（https、无凭据），跟随一次跳转安全。

## 2. 固定下载约定（tag=latest / 固定包名）

用户要求「点更新就能完成更新（打开固定下载地址）」，因此约定：

- release tag **恒为 `latest`**（不是 `vX.Y.Z`）；每次发版**覆盖同一 tag 的附件**。
- 附件名 **恒为 `hesora-inventory-setup.exe`**（与 electron-builder 的 `artifactName` 无关的固定名）。
- manifest 的 `url` **可以省略**：`resolveDownloadUrl()` 纯函数会拼接
  `https://gitee.com/xyueji/hesora/releases/download/latest/hesora-inventory-setup.exe`。
- 拼接结果仍须通过域名白名单校验后才交给 `update:openUrl`。
- 常量（定义于 `src/main/services/update/update.service.ts`）：
  `UPDATE_RELEASE_TAG='latest'`、`UPDATE_PACKAGE_NAME='hesora-inventory-setup.exe'`、
  `DEFAULT_RELEASE_BASE_URL`、以及可注入覆盖的 `FixedAssetConfig`（`fixedAsset` 选项）。

> 选 Gitee release 附件作固定地址的原因：实测 Gitee release 附件**免登录可匿名下载**
> （302 → attach_files → 302 → `foruda.gitee.com` → 200 `application/zip`），
> 且 `foruda.gitee.com` 被 `*.gitee.com` 白名单覆盖。早前「Gitee 附件需登录」的假设已被实测推翻。

## 3. 双渠道语义（重要）

`check()` 按 `updateUrls` 的**顺序**逐个尝试（Gitee 在前）：

1. 某渠道「失败」——网络异常 / 非 2xx / JSON 解析失败 / `version` 非法 / 字段类型错误 /
   `sha256` 非法 / manifest 地址或下载链接校验失败 → **继续下一个渠道**。
2. 某渠道「有效但无更新」——manifest 合法但版本不比当前新 → **立即返回 `{ hasUpdate: false }`，
   不再回退**。这是刻意设计：避免一个陈旧的 Gitee manifest 遮蔽 GitHub 上已发布的新版本。
3. 某渠道「有效且有更新」→ 返回该结果，附带 `source` 与（若 manifest 提供）`sha256`。
4. 全部渠道失败（或没配置渠道）→ 返回 `{ hasUpdate: false }`，静默、绝不抛出。

`source` 按 **manifest 地址**的主机名判定：`gitee` / `github` / `custom`。

> 因此**发布时必须两处 manifest 同步为同一版本**：Gitee 若停在旧版，客户端会停在第 2 种情况而
> 永远不会看到 GitHub 上的新版。详见第 7 节。

## 4. 环境变量与默认真实地址

`src/main/update.ts` 内置默认常量（可被环境变量覆盖）：

| 变量 | 默认值 | 用途 |
|---|---|---|
| `HESORA_UPDATE_GITEE_URL` | `https://gitee.com/xyueji/hesora/raw/main/latest.json` | Gitee 渠道 manifest（优先） |
| `HESORA_UPDATE_GITHUB_URL` | `https://raw.githubusercontent.com/xyueji/hesora/main/latest.json` | GitHub 渠道 manifest（回退） |
| `HESORA_UPDATE_URL` | （空） | 旧变量，兼容单渠道；**设置后作为唯一渠道覆盖默认双渠道** |

装配规则：默认 `[GITEE_URL, GITHUB_URL]`（Gitee 在前）；若设置 `HESORA_UPDATE_URL` 则作为唯一渠道。
URL 合法性校验（https、无凭据）在 `check()` 内部完成，`update.ts` 只负责组装数组。
`update:check` 仍把返回结果的 `downloadUrl` 记入 `allowedUrl`，`update:openUrl` 只放行该精确 URL。

最新 release 推荐路径（两处 `latest.json` 内容必须一致，尤其 `version` 与 `sha256`）：

- **Gitee**：`https://gitee.com/xyueji/hesora/raw/main/latest.json`
- **GitHub**：`https://raw.githubusercontent.com/xyueji/hesora/main/latest.json`

## 5. 域名白名单（安全）

下载链接主机只允许以下模式，其余 `https` 地址一律拒绝（防 manifest 被篡改指向任意地址）：

- `github.com`、`*.githubusercontent.com`（含 `raw.githubusercontent.com`）、`github.io`、`*.github.io`
- `gitee.com`、`*.gitee.com`（含 Gitee 附件 CDN `foruda.gitee.com`）、`gitee.io`、`*.gitee.io`
- `raw.giteeusercontent.com`、`*.giteeusercontent.com`（Gitee raw 的 302 目标域名）

`createUpdateService` 可选 `allowHosts?: readonly string[]` 覆盖内置白名单（传入后**不再**使用内置列表），
便于自建更新服务器；匹配支持 `*.` 子域通配与精确主机。白名单**只作用于下载链接主机**，
manifest 地址本身仍需 https + 无凭据（不限制主机，便于自定义域名）。

## 6. 自动更新的现实边界（重要）

当前架构是**「检查 → 提示 → 打开固定下载地址」**：用户点击通知后由系统浏览器下载安装包，
再**手动运行覆盖安装**。本轮**没有**实现自动下载 + 自动安装。

- `electron-updater` 等自动更新方案需要**代码签名**与差分/校验基础设施，而当前安装包**未签名**；
  未签名包做静默自动安装既过不了系统校验，也有供应链安全风险。
- 若用户要真正「一键自动更新」，属**二期工程**：引入 `electron-updater` + 代码签名证书 +
  发布 feed（latest.yml 等），成本与风险另议。请勿把本轮的「打开下载地址」误认为自动安装。

## 7. 发布清单（发版时用户需要做什么）

> **🔴 红线：发布仓库仅用于分发安装包与更新清单，禁止推送源码。**
> Gitee / GitHub 的 `xyueji/hesora` 只允许放 `latest.json` 与 `tag=latest` 的 release 附件（安装包）；
> **严禁 `git push` 源码、严禁上传 `src/` 或任何源码文件**。本仓库是纯分发渠道，**不是源码仓库**。
> 本地开发仓库 `D:/xiong/project/x-sofware/hesora-inventory` **没有配置任何 git remote**（已核实
> `git remote -v` 为空），请保持这样；本文档与脚本中**不要出现** `git remote add` / `git push` 之类指令。
> **官方渠道只提供安装包，不提供源码。**

> **SSH 公钥 ≠ 发布凭证，务必区分（用户已配置 SSH 公钥，但那不能用于发布）：**
> - 客户端检查更新走 **HTTPS 匿名 GET**（`latest.json` + release 附件下载），**完全不需要任何密钥**，
>   SSH 公钥与此无关。
> - 发布时上传 release 附件走 **HTTPS API + 访问令牌**：Gitee 用私人令牌
>   （`https://gitee.com/profile/personal_access_tokens`），GitHub 用 PAT
>   （`https://github.com/settings/tokens`，需 `repo` scope）。
> - **SSH 公钥只用于日常代码管理（`git push` 代码），与 release 发布无关，不能用于 release API 上传附件。**
> - Token **仅本地保管，绝不入包、绝不写进文档、绝不提交**；代码中不写死任何 token/凭据。

每次发版：

1. 备好两个平台访问令牌（**仅本地保管，绝不入包、绝不提交**）。
2. 用 API / 网页在 Gitee 与 GitHub 创建（或复用）tag=`latest` 的 release，上传**固定包名**
   `hesora-inventory-setup.exe` 的附件（覆盖同一 tag 的附件）。
3. 用安装包实际哈希计算 `sha256`，更新**两个仓库 `main` 分支**的 `latest.json`：
   `version` 递增、`notes`、`sha256` 必填、`url` 可省略（走固定拼接）。
4. Gitee 与 GitHub 两处内容保持一致；确认 `version` > 当前客户端版本（当前 `1.3.0`）。
5. 验收：用 `curl -L -o /dev/null -w '%{http_code}'` 检查两个 raw `latest.json` 均 200 且版本一致
   （**Gitee raw 不带 `-L` 会返回 302，必须跟随一次重定向**）；`curl -I` 固定下载地址可匿名 200。

## 8. 常见问题 / 验收依据（2026-11-10 实测）

- **GitHub `xyueji/hesora`**：公开仓库，默认分支 `main`；`GET /releases/tags/latest` 返回 200
  （id=440192256，tag=`latest`，assets=0，upload_url 可用）——**latest release 已存在但还没有附件**。
- **Gitee `xyueji/hesora`**：仓库存在，默认分支 `main`；releases 列表为空，
  `/raw/main/latest.json` 当前 404，`/releases/tags/latest` 返回 null——**Gitee 侧还没建
  latest release 与 manifest**（对应第 7 节步骤 2、3 待办）。
- **Gitee 附件下载免登录已实测通过**：302 → attach_files → 302 → `foruda.gitee.com` → 200
  `application/zip`，故固定地址指向 Gitee release 可用。
- **Gitee raw 必 302（实测）**：
  `curl -o /dev/null -w "%{http_code} %{redirect_url}" https://gitee.com/oschina/git-osc/raw/master/README.md`
  → `302 https://raw.giteeusercontent.com/oschina/git-osc/raw/master/README.md?signature=...`，
  `curl -L` 后 200（`num_redirects=1`）。因此客户端**允许跟随重定向**（见第 1 节
  `redirect: 'follow'`）；若企业网络拦截 `raw.giteeusercontent.com`，Gitee 渠道会静默失败并回退 GitHub。
- **本机 `raw.githubusercontent.com` DNS 解析失败（curl exit 6），但 `api.github.com` 正常**：
  这是**本机网络环境问题，不是代码缺陷**；`raw.githubusercontent.com` 在国内可能被 DNS 污染，
  因此「Gitee 优先 + GitHub 回退」是必要设计——Gitee 快且稳，GitHub 作为冗余。
- **配了 SSH 公钥为什么还要 token？** 见第 7 节：SSH 只管 `git push`，release 附件上传用 HTTPS API + token。

## 9. 待主会话接线：MainLayout 更新提示（sha256 展示）

> 本文件改动按边界要求**未触碰** `src/renderer/src/layouts/MainLayout.vue`（该文件由 T9-Client
> 代理维护）。请主会话在合并时代为接线，改动很小：

`src/renderer/src/api/update.ts` 的 `UpdateCheckResult` 已新增 `source?` 与 `sha256?`，
`src/renderer/src/layouts/MainLayout.vue` 的 `notifyUpdate()` 拿到 `r` 后：在 `ElNotification`
的 `message` 里追加 sha256 摘要（前 8 位）并提供「复制全文」按钮。

参考补丁（用 `h()` 渲染，`import { h } from 'vue'`，需同时从 `element-plus` 引入 `ElMessage`）：

```ts
import { h } from 'vue'
// ...在 notifyUpdate() 内：
if (r && r.hasUpdate) {
  const notifyMessage = () =>
    h('div', [
      h('div', r.notes || `新版本 ${r.latestVersion ?? ''} 已发布`),
      r.sha256
        ? h('div', { style: 'margin-top:6px;font-size:12px;opacity:.8' }, [
            h('span', `SHA-256: ${r.sha256.slice(0, 8)}… `),
            h(
              'a',
              {
                href: '#',
                onClick: (e: Event) => {
                  e.preventDefault()
                  void navigator.clipboard?.writeText(r.sha256 ?? '').then(() =>
                    ElMessage.success('已复制 SHA-256')
                  )
                }
              },
              '复制全文'
            )
          ])
        : null
    ])
  ElNotification({
    title: '发现新版本',
    message: notifyMessage(),
    type: 'info',
    duration: 0,
    onClick: () => {
      if (r.downloadUrl) void updateApi.openUrl(r.downloadUrl)
    }
  })
}
```

说明：仅展示前 8 位 + 复制全文按钮，不改变原有通知点击下载行为；复制用
`navigator.clipboard`（渲染层可用，不涉及 FS/DB）。`checkDaily()` 保持不变。

## 10. 需用户提供的信息（更新）

- **仓库地址：已提供并落地**——`xyueji/hesora`，默认 URL 已写入 `update.ts` 常量与本文（原任务书
  要求用 `<owner>/<repo>` 占位并列「需用户提供」，此项现已解决）。
- 仍需用户**自行创建/保管**：Gitee 私人令牌、GitHub PAT（`repo` scope）——见第 7 节。
- 仍需用户**执行**：在两平台建 `latest` release、上传固定包名附件、同步两个 `latest.json`。

## 11. 相关文件

- `src/main/services/update/update.service.ts` — 多渠道 `check()`、白名单、sha256 校验、source 判定、
  `resolveDownloadUrl()` 固定下载拼接。
- `src/main/update.ts` — 环境变量装配 `updateUrls`（Gitee 在前）+ 默认真实 URL + `update:openUrl` 白名单。
- `src/renderer/src/api/update.ts` — `UpdateCheckResult` 增加 `source?` / `sha256?`。
- `tests/unit/update.service.test.ts` — 渠道回退/不回退、白名单、sha256、source、固定拼接用例。

# 云盘 Provider 适配研究报告

> 研究对象：AList（Go）网盘驱动设计 —— `D:/xiong/project/x-sofware/reference/alist`（只读参考，AGPL-3.0 授权）
> 研究目的：为 hesora-inventory（Electron + better-sqlite3 离线进销存）自研 TypeScript `CloudProvider` 适配层提供设计参考。
> **本报告只提炼设计思想与调用序列，明确反对拷贝任何 alist 源码**（理由见 §7 合规边界）。所有行号以本仓库当前代码为准。

参考的我们的接口（文档既有设计）：

```ts
interface CloudProvider {
  capabilities: Capabilities;
  beginAuthorization(): Promise<AuthBegin>;
  completeAuthorization(code: string): Promise<void>;
  refreshAuthorization(): Promise<void>;
  ensureFolder(path: string): Promise<FolderRef>;
  upload(path: string, data: Stream, opts?: UploadOpts): Promise<FileStat>;
  download(path: string): Promise<Stream>;
  stat(path: string): Promise<FileStat | null>;
  list(path: string): Promise<FileStat[]>;
  delete(path: string): Promise<void>;
  revoke(): Promise<void>;
}
```

---

## 1. 驱动接口抽象：alist 的小接口拆分 vs 我们的单一 CloudProvider

### 1.1 alist 的做法

alist 将驱动能力拆成一组**小接口**，由驱动按需实现，运行时做类型断言探测：

- 核心入口 `internal/driver/driver.go:9-14`：`Driver` = `Meta` + `Reader`（Writer 被注释掉，故意不作为必需能力）。
- `Meta`（driver.go:16-26）：`Config()/GetStorage()/SetStorage()/GetAddition()/Init()/Drop()` —— 生命周期与"附加配置"的 JSON 反序列化通道。
- `Reader`（driver.go:32-39）：只有 `List` 和 `Link`。**`Link` 是 alist 的灵魂**：返回"一个可直接 GET 的下载直链 + 过期时间/必需请求头"（`model.Link`），让代理/302/预览全部复用同一条路径。
- 写能力按操作拆成独立接口（driver.go:59-111）：`Mkdir / Move / Rename / Copy / Remove / Put / PutURL`，并且每个操作还有 `*Result` 变体（driver.go:122-170，返回新建对象的 Obj 而不仅是 error）。
- `GetRooter`（driver.go:41-44）：允许驱动自定义根对象（如阿里云盘 root 就是 `RootFolderID`，见 `drivers/aliyundrive_open/driver.go:75-84`）。
- `Getter`（driver.go:45-48）：驱动若能按 path 直接 Get，可覆盖默认的"逐级 List"实现。
- `Other`（driver.go:28-30）：万能扩展口，例如阿里云盘用它实现 `video_preview`（`drivers/aliyundrive_open/driver.go:274-296`）。
- `PutURL`（driver.go:106-111）：URL 直传入（离线下载场景），我们完全用不到。
- `ArchiveReader/ArchiveGetter/ArchiveDecompress`（driver.go:172-206）：压缩包在线浏览，同样用不到。
- `Reference`（driver.go:208-210）：多个 storage 挂载共享同一驱动实例（token/限流器共享），阿里云盘通过 `d.ref` 转发刷新与限流（`drivers/aliyundrive_open/driver.go:58-65`、`util.go:168-171`、`limiter.go:93-96`）。

驱动能力位声明在 `internal/driver/config.go:3-15`：`NoUpload / NeedMs / DefaultRoot / CheckStatus / NoOverwriteUpload / ProxyRangeOption` 等。其中 **`NoOverwriteUpload`**（config.go:14）标记"该盘不支持覆盖上传"，上传层据此走"先改名旧文件"策略（见 §5）。

### 1.2 与我们的 CloudProvider 对比：缺什么、要不要补

| alist 能力 | 我们是否需要 | 结论 |
|---|---|---|
| `Link` 直链 | 备份场景是"我们自己在客户端下载恢复"，不需要把链接交给第三方 | **不需要**。但下载恢复时阿里/百度返回的其实是限时直链，我们的 `download()` 内部仍要走"先拿直链再 GET"两步，只是封装在方法内部，不暴露给上层 |
| `PutURL` | 不需要（无离线下载场景） | 不补 |
| `Other` 扩展 | 不需要。我们不做在线预览 | 不补；真有扩展需求时用 TS 的可选方法/接口交叉类型即可 |
| `Mkdir/Move/Rename/Copy/Remove` 全套 | 我们只有 `ensureFolder/upload/download/stat/list/delete` | **备份场景足够**。但建议补一个可选的 `rename(path, newName)`：用于"上传前把旧备份改名 .bak，成功后删除"的原子化轮替（§5，对应 alist `op.Put` 的 tempName 策略，`internal/op/fs.go:623-646`） |
| `Meta.GetAddition()` 附加配置通道 | 我们的凭据（client_id/secret/refresh_token）目前散在授权模块 | **建议吸收**：每个 provider 声明自己的 `Addition` schema（持久化在 SQLite 的 cloud_accounts 表），授权模块只负责通用流程。alist 驱动刷新 token 后调 `op.MustSaveDriverStorage(d)` 把新 refresh_token 持久化（`drivers/aliyundrive_open/util.go:197`、`internal/op/storage.go:334-349`），这一点我们必须有——refresh_token 是一次一换的，丢了就要重新扫码授权 |
| `*Result` 变体（写操作返回 Obj） | 值得要：`upload()` 返回 `FileStat`（含远端 file_id/size/hash）才能写备份记录 | **我们的 `upload` 应返回 FileStat**（文档里返回类型要核实，若目前是 void 必须改） |
| `Config()` 能力位 | 我们已有 `capabilities`，方向一致 | 建议补充字段：`supportsOverwrite`（百度 rtype=3 支持覆盖、阿里 open 是"同名 ignore 生成新版本"语义）、`maxChunkSize`、`recommendedChunkSize`、`supportsRapidUpload`、`rateLimitPerSecond`（见 §2.4） |
| `GetRooter` / root 语义 | 需要。阿里 root_folder_id = "root"，百度用绝对路径 | stat/list/ensureFolder 的实现内部处理，接口无需改 |
| `Reference`（多挂载共享实例） | 不需要（单账号单实例） | 不补，但 token 刷新必须进程内单飞（§4） |

### 1.3 接口修订建议（汇总）

1. `upload()` 返回 `FileStat`（含 provider 侧 file_id、size、可选 hash）。
2. `capabilities` 增加 `supportsOverwrite` / `recommendedChunkSize` / `supportsRapidUpload` / `rateLimit`。
3. 新增可选 `rename(path, newName)`（云盘不支持时由适配层用 copy+delete 模拟或直接禁用）。
4. 每个 provider 增加 `additions` 声明式配置（client_id/secret 等随账号持久化、可序列化），授权层与业务层解耦。
5. `stat()`/`list()` 返回统一包含 `providerFileId`、`modifiedAt`、`size`、`hash?`（阿里 sha1、百度 md5）——恢复校验要用。

---

## 2. 阿里云盘 open（drivers/aliyundrive_open/，6 个文件）

### 2.1 文件构成

- `meta.go`：Addition 配置 + driver.Config 能力位 + API_URL 常量。
- `driver.go`：接口实现（List/Link/MakeDir/Move/Rename/Copy/Remove/Put/Other）。
- `util.go`：token 刷新、request 封装、分页 list、错误重试。
- `upload.go`：create → 分片 → complete 的完整上传流。
- `limiter.go`：按用户维度的三类限速器。
- `types.go`：API 响应结构。

### 2.2 OAuth 刷新流程与**合规关键差异**

alist 支持两条刷新路径（`drivers/aliyundrive_open/util.go:36-45`）：

1. **托管中转**：`OauthTokenURL` 非空且 `ClientID` 为空时走 `refreshTokenWithOnlineAPI`（util.go:47-87），默认地址 `https://api.alistgo.com/alist/ali_open/token`（util.go:22），即 **alist 官方把自己的 client_id/secret 架在中间服务器上，替所有用户换 token**（新版是 GET 带 `refresh_ui` 参数，旧版 POST，还带 legacy fallback，util.go:89-102）。
2. **自有凭据**：`ClientID/ClientSecret` 非空时走 `refreshTokenWithPost`（util.go:104-154），POST 到 `API_URL + "/oauth/access_token"`，body 为 `{client_id, client_secret, grant_type: "refresh_token", refresh_token}`。

> **我们必须且只能走第 2 条**：在 [阿里云盘开放平台](https://www.alipan.com/dev) 申请自有开发者应用，拿自有 client_id/client_secret，直接调官方 `https://openapi.alipan.com/oauth/access_token` 刷新。绝不能把 alist 的托管端点写进我们的闭源产品——那是 alist 的服务资源，随时会限流/下线（代码里就大量处理 429，util.go:75-102、125-134），且把我们的用户 token 发给第三方中转本身就不合规。API_URL 常量 = `https://openapi.alipan.com`（meta.go:35）。

刷新流程细节（全部值得抄思路）：

- 刷新成功后**校验新 refresh_token 的 JWT sub 与旧 token 一致**（util.go:142-152，`getSub` 解 JWT payload，util.go:156-166），防止串号。
- 限流失败重试最多 3 次，按 Retry-After 或递增退避，封顶 15s（util.go:173-191）。
- 刷新成功立即 `op.MustSaveDriverStorage(d)` 持久化（util.go:196-197）。
- **阿里 refresh_token 是"旋转"的**：每次刷新都返回新的 refresh_token（util.go:196 `d.RefreshToken, d.AccessToken = refresh, access`），旧 refresh_token 即作废。多设备并发刷新会互相踢掉——我们单机单进程影响小，但必须持久化后再用，且刷新要单飞（§4）。

### 2.3 401/错误码处理与请求封装

`requestReturnErrResp`（util.go:223-257）是所有 API 调用的统一入口：

- 统一带 `Authorization: Bearer <access_token>`（util.go:226）。
- 每个请求先过对应限速器（util.go:235）。
- 响应里的业务错误码（`ErrResp{Code,Message}`，types.go:10-13）命中 `AccessTokenInvalid / AccessTokenExpired / I400JD` 或 access_token 为空时：**刷新 token 后原样重放一次请求**（util.go:247-253，`retry=true` 防止无限递归重放）。
- 其他错误直接抛 `code:message`。

这个"命中 token 类错误码 → 刷新 → 重放一次"的模式，就是我们状态机 `AUTHORIZED → REFRESHING → (成功回到 AUTHORIZED / 失败进 REAUTH_REQUIRED)` 的运行时实现（见 §4）。

### 2.4 限流器设计（limiter.go）

- 限速按**用户维度**而非 storage 实例维度共享（limiter.go:11-12 注释、limiter.go:40-62）：同一用户开多个挂载共用一个 limiter，用 `usedBy` 引用计数 + Drop 时释放（limiter.go:80-87，driver.go:47-49、53-54）。
- 三类操作三类限速（limiter.go:15-26）：`list ≈ 3.9/s`、`link ≈ 0.9/s`、`other ≈ 14.9/s`，全部 `rate.NewLimiter(rate.Limit(x), 1)`（无突发）。
- Init 时先拿 user_id 再换成按用户的 limiter（driver.go:45-54）。

> 注意：3.9/0.9/14.9 这些数值是社区从官方文档/实测总结的（`需官方文档核实`当前配额）。我们适配器按"每类操作一个 p-limit/rate-limiter（建议用 bottleneck 或自写 token bucket）"实现即可，数值留配置可调。

### 2.5 drive_type：资源盘 / 备份盘

- Addition `DriveType` 取值 `default,resource,backup`（meta.go:9，默认 resource）。
- Init 时 `getDriveInfo` 返回的 JSON 里取 `DriveType + "_drive_id"`（driver.go:45-51）：即 `default_drive_id`（资源盘）/ `backup_drive_id`（备份盘）。之后所有操作用这个 drive_id。
- **对备份场景的意义**：备份盘是阿里专门给"备份类应用"的独立空间，与我们目标完全匹配。我们应默认申请并使用 backup 盘（开发者应用里需勾选/确认，`需官方文档核实` backup 盘是否对普通应用开放）。

### 2.6 上传流程（upload.go，逐段）

`calPartSize`（upload.go:33-51）：默认 20MB 分片；文件 >128GB 起按档位加大（26/39/52/78/104MB），>1TB 用 5GB。上限 10000 分片（upload.go:151-152 注释 ≈195GB @20MB）。我们备份文件远小于此，**固定 20MB 即可，档位逻辑不需要**。

`upload()` 主流程（upload.go:149-269）：

1. **create**：POST `/adrive/v1.0/openFile/create`，带 `parent_file_id / name / type:file / check_name_mode:"ignore" / local_modified_at / local_created_at / part_info_list`（upload.go:158-188）。`check_name_mode:"ignore"` = 同名不报错，产生新版本（阿里文件是版本化的）。
2. **秒传探测（可选）**：若启用 RapidUpload 且 size>100KB（upload.go:170），先算**前 1024 字节的 SHA1 作为 pre_hash** 随 create 提交；服务端返回 `PreHashMatched` 错误码时（upload.go:190），再补全量 SHA1（`content_hash`）+ **proof_code**（upload.go:203-213）：proof_code 是"用 access_token 的 MD5 前 16 hex 映射到文件内一个 8 字节偏移区间，取该区间内容 base64"（`getProofRange`+`calProofCode`，upload.go:108-147）——服务端用它验证你真的持有该文件而非仅知道 hash。create 响应 `RapidUpload=true` 则跳过传输（upload.go:263-265）。
3. **正常分片上传**：顺序遍历 `PartInfoList`，每片 `PUT upload_url`（upload.go:226-262）：
   - **分片 URL 50 分钟过期刷新**：距上次获取超 50min 时调 `getUploadUrl`（带 upload_id）重新拿全部片 URL（upload.go:231-237）。慢速大文件必备。
   - 每片用 `retry.Do` 重试 3 次、1s 起指数退避（upload.go:249-256），重试前 Reset reader（分片数据可重放——我们把每个分片先读进内存/临时文件是关键）。
   - 限速包裹：`driver.NewLimitedUploadStream`（upload.go:251）。
4. **complete**：POST `/adrive/v1.0/openFile/complete`（file_id+upload_id）返回最终 File 对象（upload.go:87-101）。
5. `InternalUpload`（meta.go:19，upload.go:69-71）：阿里云 ECS 北京内网时把上传 URL 替换成 OSS 内网域名加速——我们的桌面客户端用不上，忽略。

### 2.7 我们适配器必须实现的调用序列（伪代码）

```ts
async refreshAuthorization() {
  // 1. 单飞；2. POST https://openapi.alipan.com/oauth/access_token
  //    body: { client_id, client_secret, grant_type: "refresh_token", refresh_token }
  // 3. 429 → 读 Retry-After，指数退避，最多 3 次，封顶 15s
  // 4. 校验新 refresh_token 的 JWT sub === 旧 sub（可选但推荐）
  // 5. 持久化 { access_token, refresh_token }（refresh_token 已旋转！）
}

async ensureAuthorized<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (isAliyunTokenError(e)) {           // AccessTokenInvalid / AccessTokenExpired / I400JD
      await refreshAuthorization();        // 内部单飞
      return await fn();                   // 只重放一次
    }
    throw e;
  }
}

async upload(remotePath, data, { size, sha1Hex, mtime, ctime }): Promise<FileStat> {
  const parent = await ensureFolder(dirname(remotePath));   // create(type:folder, check_name_mode:"refuse")，已存在则容忍 exist 错误
  // 1) create（不启用秒传，见 §8 裁剪）
  const create = await ensureAuthorized(() => api.post("/adrive/v1.0/openFile/create", {
    drive_id, parent_file_id: parent.fileId, name: basename(remotePath),
    type: "file", check_name_mode: "ignore",
    local_modified_at: iso(mtime), local_created_at: iso(ctime),
    size, part_info_list: partsFor(size, 20 * MB),
  }));
  // 2) 分片：顺序（或 ≤3 并发）PUT part.upload_url；每片缓冲到可重放；
  //    每 50min 刷新分片 URL（getUploadUrl + upload_id）；每片失败重试 3 次指数退避；
  //    上传中响应 ctx 取消（AbortSignal）。
  // 3) complete(file_id, upload_id) → 返回 { file_id, size, content_hash? }
}

async download(remotePath): Promise<Stream> {
  const st = await stat(remotePath);           // list 或 get(file_id)
  const link = await ensureAuthorized(() => api.post("/adrive/v1.0/openFile/getDownloadUrl",
    { drive_id, file_id: st.fileId, expire_sec: 14400 }));   // driver.go:105-110，4h 有效
  return fetch(link.url, { signal });          // 失效则重取一次直链再重试
}
```

---

## 3. 百度网盘（drivers/baidu_netdisk/，5 个文件）

### 3.1 认证

- 刷新端点 `https://openapi.baidu.com/oauth/2.0/token`，GET 带 `grant_type=refresh_token / refresh_token / client_id / client_secret`（util.go:33-42）。返回**新 access_token 与新 refresh_token**（util.go:52），同样要持久化。
- 刷新失败若为 `EmptyToken` 会再试一次（util.go:25-31）。
- meta.go 里默认填了 alist 官方的 ClientID/ClientSecret（meta.go `default:"hq9yQ9w9..."`）——**我们不能复用**，必须在 [百度网盘开放平台](https://pan.baidu.com/union) 申请自有应用（个人开发者可申请，`需官方文档核实`当前审核政策与 quota）。
- access_token 有效期 30 天（10 年 refresh_token），**且不像阿里那样每次旋转**，但代码仍按返回值整体覆盖（util.go:52）。`需官方文档核实` refresh_token 是否长期不变。

### 3.2 请求封装与错误码映射（util.go:57-98）

- `request()` 外层 `retry.Do` 3 次、1s 指数退避；每次检查响应 JSON 的 `errno`。
- **errno ∈ {111, -6, 20016} → 触发 refreshToken()**（util.go:75-81）：111 = access_token 失效，-6 = 身份验证失败，20016 = token 无效（`需官方文档核实` 20016 语义）。刷新成功后该轮 retry 自然用新 token 重发。
- 其他 errno 抛错并附上文档链接（util.go:88）。
- 常见 errno（来自代码与官方文档，`需官方文档核实`）：-6 身份失效、111 token 失效、31023 文件已存在（官方 dlink 场景）、12/-70 上传文件数超限/命中敏感。映射到我们的统一错误：`AuthError(-6/111/20016) / ConflictError(31023) / TransientError(网络) / PermanentError(其他)`。

### 3.3 上传三步（driver.go:197-387）

1. **预创建 precreate**（driver.go:390-422）：POST form 到 `/xpan/file?method=precreate`，字段 `path/size/isdir=0/autoinit=1/rtype=3/block_list(JSON 数组：每片 md5)/content-md5(整文件 md5)/slice-md5(前 256KB md5)/local_mtime/local_ctime`。
   - **rtype=3**（driver.go:254, util.go:397）= 同名覆盖（0 报错/1 重命名/2 重建/3 覆盖）。备份场景用 3 最省事（但注意 §5 的旧文件保护策略仍建议保留）。
   - 响应 `return_type=2` ⇒ **秒传命中**，`info` 里直接是文件对象，结束（driver.go:289-293）；`return_type=1` ⇒ 返回 `uploadid` + `block_list`（**只包含还需要上传的分片序号**，断点续传的天然形式）。
2. **分片上传 superfile2**（driver.go:461-508）：POST `{uploadUrl}/rest/2.0/pcs/superfile2?method=upload&type=tmpfile&path&uploadid&partseq`，multipart 文件字段。
   - 分片大小 `getSliceSize`（util.go:283-342）：**非会员固定 4MB**（util.go:275, 285-294）；普通会员 16MB、超级会员 32MB（util.go:276-277）；分片序号上限实测 2048（util.go:279，`MaxSliceNum=2048`——注释明说"文档写的是 1024/没写，但实际测试是 2048"）。单文件上限 = 2048×4MB = 8GB（非会员）。
   - 上传域名**动态获取**（util.go:344-388）：`locateupload` 接口拿专属上传域名，结果 singleflight 合并并发 + 缓存 1h（`UPLOAD_URL_EXPIRE_TIME`，meta.go 常量区），失败回退 `https://d.pcs.baidu.com`。
   - 每片重试 3 次、退避 1s→5s 封顶（`UPLOAD_RETRY_*`，meta.go 常量区；driver.go:427-431）；body 用 `io.SectionReader(file, offset, size)` 按需重建，**分片数据必须可随机读**（driver.go:307-310 强制 ReaderAt）。
   - **uploadid 过期检测**：响应文本含 "uploadid"+"invalid/expired/not found" ⇒ `ErrUploadIDExpired`（driver.go:448-451），外层捕获后**清空 md5 重新 precreate、全部重传**（driver.go:357-371）。
3. **合并 create**（driver.go:246-267）：POST form `/xpan/file?method=create`，`path/size/isdir=0/rtype=3/uploadid/block_list`。
   - 百度 API 返回的 ctime/mtime 是"当前时间"而非文件时间（driver.go:195-196 注释），代码手动覆盖回本地时间——**我们持久化备份元数据时不能信云盘返回的时间戳，要自己存**。

断点续传进度：进程内缓存 `base.SaveUploadProgress/GetUploadProgress`（drivers/base/upload.go:16-31，键 = driver 名 + access_token + contentMd5，20 分钟过期，Get 是取回即删）。失败时把 `block_list` 中未完成的分片存回去（driver.go:350-352），下次上传同文件（同 contentMd5）直接跳过已完成分片（driver.go:282-294）。

### 3.4 秒传机制

- 百度秒传在 `precreate` 一并完成：`content-md5`（整文件）+ `slice-md5`（**前 256KB** 的 md5，driver.go:236 `const SliceSize int64 = 256 * utils.KB`）命中即 return_type=2。另有 `PutRapid`（driver.go:170-191）用本地已算好的 md5 直接 create 试探秒传。
- 从服务端 list 回来的 `md5` 字段是**混淆过的**，需要 `DecryptMd5` 还原（util.go:427-445；types.go fileToObj 注释"直接获取的MD5是错误的"）。若我们后续要做"恢复后校验"，要么用还原后的 md5，要么自己下载后重算。**第一版不做秒传**（§8），但我们上传时反正要算整文件 md5（precreate 必填），顺手保留该 hash 用于恢复校验即可。

### 3.5 调用序列伪代码

```ts
async upload(remotePath, data, { size, mtime, ctime }): Promise<FileStat> {
  if (size < 1) throw new Error("baidu: 空文件不允许上传");      // driver.go:199-201
  // 计算整文件 md5 + 每片 md5（片大小 = sliceSize；非会员 4MB）+ 前 256KB slice-md5
  const hashes = await computeHashes(data, sliceSize);          // 顺手落地临时文件（分片需可重读）
  // 1) precreate（无秒传：不带 content-md5/slice-md5 也行；但带上可白拿秒传，且代码显示必填校验宽松）
  let pre = await postForm("/xpan/file?method=precreate", {
    path: remotePath, size, isdir: 0, autoinit: 1, rtype: 3,
    block_list: JSON.stringify(hashes.blockMd5s),
    "content-md5": hashes.fileMd5, "slice-md5": hashes.sliceMd5,
    local_mtime: mtime, local_ctime: ctime,
  });
  if (pre.return_type === 2) return toStat(pre.info);           // 秒传命中（第一版可视为"免费福利"，无需主动做）
  // 2) superfile2：对 pre.block_list 中每个 partseq 并发(≤3)上传
  //    PUT 域名 = locateupload() 结果，缓存 1h，singleflight 合并；失败回退 d.pcs.baidu.com
  //    每片重试 3 次指数退避；遇到 uploadid expired ⇒ 重新 precreate 后整轮重来（≤2 轮）
  //    errno 111/-6/20016 ⇒ refreshToken() 后重试
  // 3) create 合并：path/size/rtype=3/uploadid/block_list
  // 注意：返回的 ctime/mtime 不可信，备份记录的时间戳以本地为准
}
```

---

## 4. 认证状态机：alist 的刷新互斥/重授权 vs 我们的 UNBOUND→AUTHORIZING→AUTHORIZED→REFRESHING→REAUTH_REQUIRED

alist 中实际起作用的机制（散落在驱动层，而非集中状态机）：

1. **持久化回写**：token 刷新成功立即落库（阿里 util.go:196-197；百度 util.go:52-53，经 `op.MustSaveDriverStorage`，internal/op/storage.go:334-349）。
2. **惰性刷新 + 错误驱动重放**：alist **不主动提前刷新**（阿里代码里甚至有 `// TODO check whether access_token is expired`，util.go:225）——access_token 过期完全靠"请求失败→错误码命中→刷新→重放一次"（util.go:246-253；百度 util.go:75-81）。
3. **互斥**：alist **没有显式的刷新单飞锁**。它靠两件事降低并发刷新风险：a) `Reference` 共享驱动实例时刷新转发到同一实例（aliyundrive_open/driver.go:58-65、util.go:168-171）；b) 请求是顺序发的。**多请求并发遇到 401 时理论上会并发刷新多次**——阿里 refresh_token 旋转机制下这是真实风险（第一次刷新成功后其余并发刷新会拿到已作废的旧 refresh_token 而失败）。
4. **刷新失败重试**：阿里最多 3 次退避重试（util.go:173-191）；百度 EmptyToken 重试一次（util.go:25-31）。 alist **没有"刷新彻底失败 → 标记需要人工重授权"的显式状态**，失败只是报错。

对照我们的状态机 `UNBOUND→AUTHORIZING→AUTHORIZED→REFRESHING→REAUTH_REQUIRED`，alist 缺而我们**必须补**的：

1. **REFRESHING 单飞（Promise 共享）**：所有 provider 的 refresh 必须经 `inflight: Promise<void> | null` 合并——并发 401 只触发一次网络刷新，其余 await 同一个 Promise。这正是 alist 所缺（§4.3），也是百度 `singleflight` 包在**上传域名**上用对了、却在 token 上没用到的教训（util.go:381 用 `uploadUrlG.Do` 合并 locateupload 并发）。
2. **过期前主动刷新**：alist 完全惰性。我们知道 token 寿命（阿里 access_token 官方约 2h（`需官方文档核实`），百度 30 天），应在持久化时记 `expiresAt`，操作前 5 分钟内主动刷新，失败再退回错误驱动刷新。减少备份长任务中途 401。
3. **REAUTH_REQUIRED 判据**：刷新接口本身返回鉴权类错误（阿里 oauth/access_token 返回错误 code、百度返回 `error=invalid_grant`）且重试 3 次仍失败 → 状态置 REAUTH_REQUIRED 并通知 UI，**驱动所有后续操作直接抛 AuthError**（alist 无此概念，错误码会一直撞墙）。恢复路径 = 重新 beginAuthorization。
4. **REFRESHING 内不做业务请求**：单飞 Promise 期间，其他调用要么排队要么等它完成后重放；避免"半新半旧 token"并发出网。
5. 每次状态迁移写 SQLite（cloud_accounts 表含 `status, access_token, refresh_token, expires_at`，token 字段做本地加密），比 alist 只在刷新时落库更进一步。

---

## 5. 上传可靠性（internal/fs/put.go + internal/op/fs.go 值得借鉴的点）

1. **任务化**：上传封装为独立 UploadTask 队列（internal/fs/put.go:13-40，`UploadTaskManager`，tache 库），可并发、可查询进度、可取消。我们的备份上传建议同样做成任务对象（Electron 主进程队列），UI 可显示进度/暂停/重试。
2. **NoOverwriteUpload 的旧文件保护**（internal/op/fs.go:623-646、668-685）：对不支持覆盖上传的盘，上传前先把旧文件 rename 成 `name + ".alist_to_delete"`，成功后删除旧文件，失败则 rename 回来。**阿里 open 即此配置**（meta.go:33 `NoOverwriteUpload: true`）。对我们的启示：即使百度 rtype=3 支持覆盖，也建议"上传到临时名（如 `xxx.db.enc.part`）→ 成功后 rename 到正式名"的两阶段提交，任何中断都不会留下半截的正式备份文件。**前提是我们接口有 rename（§1.3 修订点 3）**。
3. **分片 checkpoint**：百度通过 precreate 的 block_list 天然支持续传（§3.3），alist 再加进程内 20min 进度缓存（drivers/base/upload.go:16-31）。我们应在 SQLite（或备份任务表）持久化 `{fileMd5, uploadId, doneParts[]}`，跨进程重启也能续传；**不要只放内存**（alist 的缓存重启即失）。
4. **分片可重放**：两个驱动都强制"重试时能重新读同一片数据"（阿里 reader Reset，upload.go:250；百度 ReaderAt + SectionReader，driver.go:467）。TS 实现：每片先读入 Buffer（≤20MB 可接受）再发，天然可重放。
5. **限速**：全局上传限速封装（internal/driver/utils.go:38-45 `NewLimitedUploadStream` 读全局限速配置）。我们用 bottleneck/自写 token bucket 包在分片写流上，且**先算 hash 再限速上传**（driver.go:95-98 注释强调顺序）。
6. **取消贯穿**：alist 反复强调 `Put` 必须响应 ctx 取消（internal/driver/driver.go:82-102 大段注释；分片循环每片检查 `utils.IsCanceled`，upload.go:227-229、driver.go:251-253）。TS 用 AbortSignal 贯穿 fetch 与分片循环。
7. **并发上限**：driver.go:100-102 注释警告——并发分片上传要用加权信号量限制线程数，避免缓冲过多分片爆内存。百度 `uploadThread 1..32`（driver.go:56-62，默认 3）。我们建议默认 3，可配置。
8. **超时**：百度单分片请求 30min 超时（meta.go `UPLOAD_TIMEOUT`）。对 4-20MB 分片 30min 过于宽松，我们建议 per-chunk 超时 = max(60s, chunkSize/预估速率×5)。

---

## 6. WebDAV 驱动（drivers/webdav/）与我们 webdav.ts 的对比

alist 的 WebDAV 驱动（driver.go，109 行）极薄：

- 底层用 fork 的 `pkg/gowebdav` 客户端；`List=ReadDir`、`MakeDir=MkdirAll`、`Put=WriteStream`（driver.go:50-107）。**Put 是整文件单请求 PUT**，没有分片（driver.go:96-107），也没有断点续传。
- **没有任何 If-None-Match/If-Match 条件请求**：gowebdav 的 WriteStream 不带 If-Match；冲突防护为零。我们 webdav.ts 用 If-None-Match/If-Match 做乐观锁，**比 alist 更严谨**，保留我们的做法。
- ETag 缺失：alist 完全不消费 ETag（List 映射只取 name/size/mtime，driver.go:55-62），stat 靠 PROPFIND 的 getlastmodified/getcontentlength。启示：**ETag 不是所有 WebDAV 服务端都可靠（尤其 Nextcloud/坚果云对 getetag 支持参差），我们的 webdav.ts 必须有"ETag 缺失时退化为 size+mtime 判断"的兜底路径**；条件请求仅在服务端确实返回 ETag 时启用。
- 目录一致性：无任何目录缓存/校验逻辑；Init 只是建 client，还用 12 小时 cron 重建 client（driver.go:32-41，SharePoint cookie 刷新需要，util.go:16-46）。对"网盘目录与本地认知漂移"问题 alist 的答案是**每次实时列目录 + op 层 LRU 缓存 + 写后清缓存**（internal/op/fs.go Put 后 `ClearCache`，fs.go:670-676）——我们的建议：每次备份前 `ensureFolder` 用 list 实测目录而非盲信本地缓存，写成功后失效该目录缓存。
- MkdirAll 语义（driver.go:77）：一次调用保证多级目录存在（客户端循环 PROPFIND+MKCOL）。我们 ensureFolder 同语义。

结论：WebDAV 兜底驱动我们现有实现的方向（条件请求）优于 alist；需要补的是 ETag 缺失兜底与两阶段上传（§5.2）。

---

## 7. 合规边界：AGPL-3.0 与自研

- alist 采用 **AGPL-3.0**（仓库 LICENSE）。AGPL 是强传染协议：分发或通过网络提供服务（§13 网络条款）时，**整个衍生作品**都必须以 AGPL 开源并提供完整对应源码。我们的 hesora-inventory 是闭源商业 EXE，一旦把 alist 的驱动代码（哪怕改写、哪怕只有一个文件的一部分）编译/打包进产品，整个产品都有被要求以 AGPL 开源的义务。
- **"概念"可以借鉴，"代码结构/表达式"不可**：AGPL 保护的是代码的表达形式，不是思想。以下属于思想，自由使用：
  - 接口拆分思路（小接口 + 能力位声明）、`Link` 直链概念、限速器按用户维度共享、`check_name_mode`/`rtype` 等**云盘官方 API 参数**（这些属于阿里/百度官方文档，不是 alist 的版权内容）、precreate→superfile2→create 三步上传流程、秒传的 pre_hash/proof_code 思想、NoOverwriteUpload 两阶段替换、错误码→刷新→重放模式。
  - **所有 API URL、请求字段、错误码请以阿里云盘开放平台与百度网盘开放平台的官方文档为准重新核对**，alist 代码只能当"易读的实现说明书"。
- 不可做：复制/翻译任何 alist 源文件（包括 types.go 的结构体定义、limiter.go、上传流程的代码骨架）、逐行"翻译成 TypeScript"、复制其注释文本。
- 本报告中的伪代码均为原创设计描述，可安全落地；实现时直接参照两家官方文档编写。

---

## 8. 最终行动清单

### 8.1 CloudProvider 接口修订点

1. `upload()` 返回 `FileStat`（含 providerFileId、size、hash?）。
2. `capabilities` 增加 `supportsOverwrite / recommendedChunkSize / supportsRapidUpload / rateLimit`。
3. 增加可选 `rename(path, newName)`（两阶段上传、旧备份轮替依赖它）。
4. Provider 声明式 `additions`（client_id/secret/driveType 等），随账号持久化与加密。
5. 统一错误分类：`AuthError / ConflictError / RateLimitError(retryAfter) / TransientError / PermanentError`。
6. 所有长操作接受 `AbortSignal`。

### 8.2 阿里云盘 open 动工前置

- 入口：阿里云盘开放平台 https://www.alipan.com/dev（"云开放平台"），申请开发者→创建应用，获得自有 `client_id/client_secret`。
- OAuth：授权码模式（网页打开授权页→回调拿 code→换 token；`需官方文档核实`回调方式——桌面应用可用 loopback/自定义 scheme 回调）。
- scope：官方 OAuth scope 至少包含文件读写（`需官方文档核实`：scope 取值如 basic / file 写明于文档）。
- 决定 drive_type：优先 `backup` 备份盘；确认应用类型允许后默认用它，否则 resource。
- 限流按 §2.4 三类速率实现且数值可配。

### 8.3 百度网盘动工前置

- 入口：百度网盘开放平台 https://pan.baidu.com/union （union 开放平台），注册开发者→创建应用→获得 `AppKey/SecretKey`，申请 `netdisk` 授权与基本文件 API 权限（`需官方文档核实`个人开发者审核与配额）。
- OAuth：授权码模式，access_token 30 天，refresh_token 换新（§3.1）。
- 确认应用 quota：非会员 4MB 分片 / 2048 片 ⇒ 单文件 8GB；备份库单文件加密后预期 <2GB，安全。
- 实现动态上传域名（locateupload）+ 回退 `https://d.pcs.baidu.com`。

### 8.4 第一版功能裁剪

**做**：授权/刷新/状态机（§4）、ensureFolder、两阶段上传（临时名→rename）、20MB(阿里)/4MB(百度)分片、分片级重试+checkpoint 持久化、上传前整文件 hash（sha1/md5）、stat/list/delete、恢复下载（直链 + 失效重取）、下载后 hash 校验、限速与 AbortSignal、WebDAV 兜底（保留条件请求 + ETag 缺失兜底）。

**不做**：主动秒传（阿里 proof_code 流程复杂、收益仅省流量；但百度 precreate 反正带 md5，秒传命中当免费福利）；在线预览/缩略图（`Other` 能力）；Move/Copy/Rename 业务面（仅内部 rename）；多账号多挂载；crack/非官方下载 API（百度 DownloadAPI 必须固定 `official`，linkCrack 系列是灰色接口，driver.go:94-99、182-231，**绝不触碰**）。

### 8.5 需官方文档核实清单（实现前必查）

1. 阿里 access_token 有效期与限流配额（openapi.alipan.com 文档）。
2. 阿里 OAuth scope 列表、桌面应用回调方式、backup 盘开放条件。
3. 百度 refresh_token 长效性、20016 等 errno 语义、个人开发者 quota。
4. 百度 MaxSliceNum 官方值（代码实测 2048，文档未写清，util.go:279）。

---

### 附：本报告引用的 alist 源码路径索引

- internal/driver/driver.go（接口拆分，:9-210）
- internal/driver/config.go（能力位，:3-15）；internal/driver/utils.go（限速流，:38-45）
- internal/op/fs.go（Put/旧文件保护，:605-685）；internal/op/storage.go（MustSaveDriverStorage，:334-349）
- internal/fs/put.go（上传任务化，:13-40）
- drivers/base/upload.go（分片进度缓存，:16-31）
- drivers/aliyundrive_open/{meta,driver,util,upload,limiter,types}.go
- drivers/baidu_netdisk/{meta,driver,util,types}.go
- drivers/webdav/{driver,util}.go
- pkg/singleflight/singleflight.go（Go 版 singleflight 参考）

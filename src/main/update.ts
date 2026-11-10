import { app, shell } from 'electron'
import { registerIpc } from './ipc/register'
import { createUpdateService } from './services/update/update.service'

// 默认渠道（可被环境变量覆盖）：Gitee 优先、GitHub 回退。
// 注意：xyueji/hesora 是「纯分发渠道」，只托管 latest.json 与 tag=latest 的安装包附件，
// 不是源码仓库，严禁 git push 源码；本文件只做匿名 HTTPS 读取，不含任何 token/凭据。
const DEFAULT_GITEE_URL = 'https://gitee.com/xyueji/hesora/raw/main/latest.json'
const DEFAULT_GITHUB_URL = 'https://raw.githubusercontent.com/xyueji/hesora/main/latest.json'

// 渠道装配：Gitee 优先、GitHub 回退；旧的 HESORA_UPDATE_URL 仅作为单渠道覆盖。
// manifest 地址与下载链接的 https/无凭据/域名白名单校验都在 createUpdateService.check() 内完成。
export function registerUpdateIpc(): void {
  const giteeUrl = process.env.HESORA_UPDATE_GITEE_URL || DEFAULT_GITEE_URL
  const githubUrl = process.env.HESORA_UPDATE_GITHUB_URL || DEFAULT_GITHUB_URL
  const legacyUrl = process.env.HESORA_UPDATE_URL || ''

  let updateUrls: string[]
  if (legacyUrl) {
    // 旧变量存在时作为唯一渠道（显式覆盖优先于默认双渠道）。
    updateUrls = [legacyUrl]
  } else {
    updateUrls = [giteeUrl, githubUrl]
  }

  const svc = createUpdateService({ currentVersion: app.getVersion(), updateUrls })
  let allowedUrl: string | undefined
  registerIpc({
    'update:check': async () => {
      const result = await svc.check()
      allowedUrl = result.downloadUrl
      return result
    },
    'update:openUrl': async (_event, url) => {
      if (!allowedUrl || url !== allowedUrl) return false
      // shell.openExternal 可能因系统无默认浏览器/策略拦截而 reject；
      // 不让异常穿透到渲染层变成未处理的 Promise rejection，明确返回失败由 UI 给出提示。
      try {
        await shell.openExternal(allowedUrl)
        return true
      } catch {
        return false
      }
    }
  })
}

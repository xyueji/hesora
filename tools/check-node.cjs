// 环境防呆：better-sqlite3 按 Node 22 ABI（NODE_MODULE_VERSION 127）编译。
// 用其它大版本运行测试/开发会 ERR_DLOPEN_FAILED，这里提前给出人话指引。
const nodeMajor = Number(process.versions.node.split('.')[0])

function checkNodeVersion() {
  if (nodeMajor !== 22) {
    console.error(
      `[环境检查] 当前 Node 版本为 ${process.versions.node}，本项目需要在 Node 22 下运行。\n` +
        `否则 better-sqlite3 原生模块将加载失败（ERR_DLOPEN_FAILED）。\n` +
        `处理方式：\n` +
        `  1) 把 PATH 指向 Node 22（例如 D:/software/node22），或\n` +
        `  2) 在 Node 22 下执行 pnpm rebuild better-sqlite3 重编译原生模块。\n` +
        `如确需跳过检查：设置环境变量 HESORA_SKIP_ENV_CHECK=1`
    )
    process.exit(1)
  }
}

if (process.env.HESORA_SKIP_ENV_CHECK !== '1') {
  checkNodeVersion()
}

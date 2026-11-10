; installer.nsh — 禾序进销存 NSIS 自定义安装脚本
;
; 由 package.json 的 build.nsis.include 引入。electron-builder 25.1.8 会把本文件
; 解析进 SHARED HEADER，而 SHARED HEADER 同时用于「安装器」与「卸载器」两次编译
; （见 NsisTarget.computeCommonInstallerScriptHeader / computeScriptAndSignUninstaller）。
; 编译参数默认带 -WX（警告即错误），因此：
;   1. 所有 !define 必须用 !ifndef 守卫，避免与 MUI2 / assistedInstaller 的 define 冲突；
;   2. 绝不能定义 MUI_PAGE_CUSTOMFUNCTION_PRE —— assistedInstaller.nsh 在
;      allowToChangeInstallationDirectory 时无条件定义它为 instFilesPre；
;   3. 只在安装器生效的内容用 `!ifndef BUILD_UNINSTALLER` 包住，避免污染卸载器。
;
; 关于"桌面快捷方式默认勾选"：electron-builder assisted 安装器没有内建桌面快捷方式
; 复选框（MUI2 Finish.nsh 仅在 MUI_FINISHPAGE_RUN / SHOWREADME 时创建复选框）。
; 这里采用方案 (b)：build.nsis.createDesktopShortcut = "always" 让安装时必然创建
; 桌面快捷方式（等价于默认勾选且不可取消），并在完成页给出中文说明，不再伪造复选框。
; 同时 build.nsis.runAfterFinish = false 去掉「运行程序」勾选框，点「完成」安装器
; 立即退出，解决"点完成卡半天"（此前默认勾选运行，安装器要等应用冷启动）。
;
; 注意：本文件在 MUI2.nsh / assistedInstaller.nsh 之前被解析（SHARED HEADER 被
; PREPEND 到 installer.nsi），所以这里定义的 MUI_FINISHPAGE_TEXT 会被
; MUI_PAGEDECLARATION_FINISH 中的 `MUI_DEFAULT MUI_FINISHPAGE_TEXT ...` 保留
; （MUI_DEFAULT 仅在未定义时才设默认值），从而覆盖完成页正文。

!ifndef BUILD_UNINSTALLER
  ; 完成页正文：单行 Label（MUI2 Finish.nsh 的 NSD_CreateLabel），保持简短。
  ; 用 !ifndef 守卫，即便将来模板/配置变了也不会因重复 !define 触发 -WX 失败。
  !ifndef MUI_FINISHPAGE_TEXT
    !define MUI_FINISHPAGE_TEXT "安装已完成。桌面快捷方式已自动创建，请双击桌面上的「${PRODUCT_NAME}」图标启动程序；安装完成后不再自动启动。"
  !endif
!endif

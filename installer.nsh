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
; ⚠ 编译顺序约束（实测 electron-builder 25.1.8 + NSIS 3.0.4.1）：
;   本文件经 SHARED HEADER 被 PREPEND 到 installer.nsi 之前，也就是说本文件内的
;   Function 体在 LogicLib.nsh（MUI2.nsh 第 27 行才 include）与 !addplugindir
;   （WinShell 等 nsis-resources 插件，由 NsisScriptGenerator.addPluginDir 注入）
;   之前编译。因此：
;   · 本文件内 Function 体禁用 ${If}/${IfNot} 等 LogicLib 宏（未定义 → -WX 失败）；
;   · 禁用 WinShell:: 插件调用（nsis-resources 插件，此时尚未 !addplugindir）；
;     System.dll 是 NSIS 内置插件（NSIS/Plugins/x86-unicode/System.dll），可用。
;   需要用到上述能力的内容一律包成 !macro（如 customUnInstall），宏体只在
;   插入点（uninstaller.nsh 的 customUnInstall 钩子，位于插件注入之后）才编译。
;
; 需求：完成页显示两个可见复选框——「运行程序」与「创建桌面快捷方式」，
; 都默认勾选、用户可取消。实现：
;   · 运行框：build.nsis 去掉 runAfterFinish:false（不再 HIDE_RUN_AFTER_FINISH），
;     assistedInstaller.nsh 恢复内建 MUI_FINISHPAGE_RUN + StartApp
;     （${StdUtils.ExecShellAsUser} 启动 $launchLink）。
;   · 桌面快捷方式框：MUI2 Finish.nsh 只有 RUN / SHOWREADME 两个复选框槽位，
;     无快捷方式框；借用 SHOWREADME 槽位改文本为「创建桌面快捷方式」，其 LEAVE
;     回调（勾选时调用）CreateShortCut。$newDesktopLink / $appExe 由
;     installer.nsi（Var，无条件声明）与 installSection.nsh setLinkVars 在安装段
;     早段赋值，完成页 LEAVE 在其后执行，可直接使用。
;     build.nsis.createDesktopShortcut=false → DO_NOT_CREATE_DESKTOP_SHORTCUT：
;     安装段 addDesktopLink 与卸载段自带的 Delete 全部禁用，快捷方式只在勾选时
;     创建，避免「安装段已创建、完成页再删/再建」的重复与冲突。
;     副作用：DO_NOT_CREATE 也禁用了卸载器的桌面快捷方式清理（uninstaller.nsh
;     该段在 !ifndef DO_NOT_CREATE... 内），故在 customUnInstall 钩子无条件补删
;     （Delete 一个不存在的 .lnk 是无害 no-op）。
;
; MUI_FINISHPAGE_* 覆盖原理：本文件在 MUI2.nsh 之前被解析，这里定义的
; MUI_FINISHPAGE_TEXT / RUN_TEXT / SHOWREADME* 会被 MUI_PAGEDECLARATION_FINISH
; 中的 `MUI_DEFAULT ...`（仅未定义时才设默认值）保留，从而生效。

!ifndef BUILD_UNINSTALLER
  ; 完成页正文：两个复选框存在时文本区高度为 MUI_FINISHPAGE_TEXT_HEIGHT_BUTTONS，
  ; 保持简短两行以内。
  !ifndef MUI_FINISHPAGE_TEXT
    !define MUI_FINISHPAGE_TEXT "安装已完成。可勾选下方选项后点击「完成」。"
  !endif

  ; 「运行程序」复选框文本（MUI_FINISHPAGE_RUN 由 assistedInstaller.nsh 在
  ; HIDE_RUN_AFTER_FINISH 未定义时内建定义，这里只覆盖文本）。
  !ifndef MUI_FINISHPAGE_RUN_TEXT
    !define MUI_FINISHPAGE_RUN_TEXT "运行 ${PRODUCT_NAME}"
  !endif

  ; 「创建桌面快捷方式」复选框：借用 MUI2 的 SHOWREADME 槽位。
  ; 不定义 MUI_FINISHPAGE_SHOWREADME_NOTCHECKED → MUI2 默认勾选。
  !ifndef MUI_FINISHPAGE_SHOWREADME
    !define MUI_FINISHPAGE_SHOWREADME
    !define MUI_FINISHPAGE_SHOWREADME_TEXT "创建桌面快捷方式"
    !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "HesoraCreateDesktopShortcut"
  !endif

  ; 勾选时由 Finish 页 LEAVE 回调调用。只用核心指令 + 内置 System 插件；
  ; 不能用 ${If} / WinShell::（见文件头「编译顺序约束」）。
  Function HesoraCreateDesktopShortcut
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_PRODUCT_FILENAME}.exe" "" "$INSTDIR\${APP_PRODUCT_FILENAME}.exe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  FunctionEnd
!endif

; 卸载器：DO_NOT_CREATE_DESKTOP_SHORTCUT 会禁用模板自带的桌面快捷方式清理，
; 在 customUnInstall 钩子无条件补删（Delete 不存在的文件是无害 no-op）。
; ⚠ 不引用 $oldDesktopLink：uninstaller.nsh 内该 Var 虽存在，但 customUnInstall
; 插入点在 un.onInit 之后、若 initMultiUser 时尚未 setLinkVars 则为空；
; 用命令行 define 现场拼路径，与创建逻辑对称。
; 注意：本 macro 体在 uninstaller.nsh:239 插入点编译，WinShell 插件已注入可用。
!ifdef BUILD_UNINSTALLER
  !macro customUnInstall
    WinShell::UninstShortcut "$DESKTOP\${SHORTCUT_NAME}.lnk"
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  !macroend
!endif

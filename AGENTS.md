# 项目约定

这是一个面向 Agent 的 Pi `apply_patch` 适配器。补丁解析与文件修改由固定版本的官方 Rust 库完成。

## 按任务读取

- 修改工具输出、失败恢复或内部协议前，读取 `README.md` 的 Execution path 和 Failure behavior，沿用其中的接口契约。
- 修改 Rust 入口或构建方式前，读取 `README.md` 的 Build the pinned helper 和 Upstream notice。
- 修改兼容策略、内部协议或 helper 替换方式前，读取 `README.md` 的 Self-modification continuity；该节记录插件编辑自身时必须保留的使用过程。
- 判断哪些行为已验证时，读取 `VERIFICATION.md`；已有 review 及其范围见 `REVIEW.md`。

## 实现边界

- TypeScript 负责进程调用、协议验证和 Agent 展示；官方库负责补丁语义及实际修改记录。
- 保持官方版本固定。源码修改只作用于 `.build/` 中的生成快照；构建保留开发 helper，并输出剥离符号后的 `bin/pi-apply-patch` 用于分发。保留外部官方 checkout 和原版程序。
- 前置验证、回滚、后台服务和自动升级属于新的需求，不并入日常适配工作。
- Agent 可见的补充信息使用英文，描述已完成的操作和必要的不确定性。内部字段与精确措辞以 README 的接口契约为准。

## 验证

- 工具行为变更优先在注册工具、后端子进程或真实 Pi 会话这些公开接口上补失败测试。
- 检查命令以 `package.json` scripts 为准；运行条件和凭据要求见 README 的 Verification。
- 修改 Agent 可见语义后，运行相关测试、类型检查和真实 Agent 恢复流程；保留可检查的临时结果。
- 只把实际执行通过的检查写入验证记录。按用户要求自行 review，当前工作流不使用子代理。

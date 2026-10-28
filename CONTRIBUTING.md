# 贡献指南

欢迎改进代码、文档和测试。较大的功能变更请先在 Issue 中描述使用场景；安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 开发流程

1. Fork 仓库，从最新 `main` 创建功能分支。
2. 安装 Node.js 22.18+，执行 `npm ci`，按 README 配置本地环境。
3. 保持变更范围清晰，修复行为问题时增加针对性测试。
4. 提交前运行：

```bash
npm test
npm run serve
```

测试不需要真实模型 Key；CI 使用 `DEMO_MODE=true`。

5. 提交 PR，说明原有问题、修改后的行为与验证结果；界面调整请附脱敏截图。

不要提交 `.env*`（示例除外）、API Key、Cookie、数据库、运行日志或用户记录。维护 lockfile，确保其他人可以用 `npm ci` 复现安装。

提交贡献即表示你有权提供相关内容，并同意按本仓库 MIT 许可证发布。

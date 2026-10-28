# 谁是人类？ · Who Is Human?

[![CI](https://github.com/mmy5067/Who_is_human-/actions/workflows/ci.yml/badge.svg)](https://github.com/mmy5067/Who_is_human-/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2022.18-339933)

一个四人社交图灵测试：**三名独立 LLM Agent 寻找唯一的人类，人类则要伪装成 AI，活过两轮投票。**

![谁是人类游戏海报](public/assets/who-is-human-poster-v2.png)

每局围绕一个没有唯一答案的社会议题展开。与常见的“找出 AI”相反，这一次需要隐藏的是人类。

## 游戏规则

1. **分配身份**：一名人类、三名 AI，玩家顺序随机。模型行动只接收公开身份与对话记录。
2. **讨论议题**：介绍自己的“模型身份”，分析议题，并对其他玩家进行公开盘问。
3. **第一轮投票**：选择疑似人类的玩家；最高票平票时随机淘汰一名平票者，人类出局则立即失败。
4. **第二轮讨论与投票**：存活玩家继续分析、盘问和投票；人类再次存活即获胜。
5. **赛后复盘**：公开身份与行动记录，各 AI 评价本局和人类的伪装方式。

提交发言前可使用“AI 检查错别字”，由玩家决定是否采纳。示例配置关闭深度思考，页面展示简短判断摘要。

## 无 Key 体验

需要 **Node.js 22.18+**（推荐 Node.js 24 LTS）、npm 和 Git，无需数据库或构建步骤。

```bash
git clone https://github.com/mmy5067/Who_is_human-.git
cd Who_is_human-
npm ci
npm run serve
```

打开 **<http://localhost:3000>**。没有 `.env` 或任一 Key 为空时，应用自动进入**演示模式**：用本地规则模拟发言、投票和总结，不调用外部模型，不产生模型费用。演示行为用于体验流程，不能代表真实模型表现。

`npm run serve` 在当前终端运行，按 `Ctrl+C` 退出。需要后台运行时使用 `npm start`。

## 接入三个真实模型

复制 [`.env.example`](.env.example) 为 `.env`：

```bash
# macOS / Linux
cp .env.example .env
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

为 `AGENT_1_*`、`AGENT_2_*`、`AGENT_3_*` 分别填写 `BASE_URL`、`API_KEY` 与 `MODEL`。可使用同一服务的不同模型，也可接入不同服务商。

示例保留 ECNU、阿里云百炼和 Xiaomi MiMo 的配置形式；服务并非免费附送，也不保证所有账号都有访问权限。应以自己的服务商配置为准，程序会在地址末尾追加 `/chat/completions`。

| 变量 | 默认 / 含义 |
| --- | --- |
| `PORT` | `3000`，HTTP 端口 |
| `AGENT_1_BASE_URL` / `API_KEY` / `MODEL` | 第一个 Agent 的接口前缀、密钥与模型 |
| `AGENT_2_BASE_URL` / `API_KEY` / `MODEL` | 第二个 Agent 的配置，同时用于文字校对 |
| `AGENT_3_BASE_URL` / `API_KEY` / `MODEL` | 第三个 Agent 的配置，同时用于生成议题 |
| `AGENT_1_ENABLE_THINKING` 等 | 示例为 `false`；变量缺省时代码按 `true` 处理 |
| `DEMO_MODE` | `auto`：任一 Key 为空或占位符就全局演示；`true`：强制演示；`false`：强制真实请求 |
| `REQUEST_TIMEOUT_MS` | 每次模型请求超时，默认 `20000` 毫秒 |
| `TRUST_PROXY` | 默认 `false`，仅在一层可信反向代理后设置为 `true` |

前两个槽位发送 `max_tokens` 与 `enable_thinking`，第三个槽位发送 `max_completion_tokens` 与 `thinking`。部分兼容接口不接受这些扩展字段，接入时可在 [`src/model-client.js`](src/model-client.js) 的 `requestBody` 中调整。

配置后重启服务。只填写一两个 Key 不会形成“部分真实、部分演示”的混合模式。模型行动请求失败时，浏览器会为该次行动生成兜底内容；议题与赛后总结也有服务端兜底，单次失败不会自动将整局切换为演示模式。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run serve` | 前台运行，适合 systemd 等进程管理器 |
| `npm run dev` | 前台运行并监听文件变化 |
| `npm start` | 后台运行，PID 与日志保存在 `.runtime/` |
| `npm stop` / `npm restart` | 停止 / 重启该后台进程 |
| `npm run status` / `npm run logs` | 查看后台状态 / 最近 100 行日志 |
| `npm test` | 游戏规则、提示词隔离和 HTTP 接口测试 |

服务器只提供静态页面与模型代理。赛局状态由浏览器内存管理，没有账号、数据库或跨设备存档；刷新页面会丢失当前局。

## 项目结构

```text
server.js                 Express 路由、中间件与错误边界
src/config.js             环境变量、Agent 配置和演示开关
src/model-client.js       模型请求、超时与 JSON 解析
src/game/context.js       公开玩家和对话记录清洗
src/game/prompts.js       行动及赛后总结提示词
src/game/action-result.js 行动身份校验、目标解析和兜底
src/game/mock.js          本地演示 Agent
public/app.js             浏览器游戏流程和界面
public/game-state.js      洗牌、状态初始化与计票
scripts/service.js        后台进程管理
test/                     自动化测试
docs/deployment.md        自部署说明
```

## 自部署与数据流

步骤见 [自部署指南](docs/deployment.md)。项目不依赖原作者的服务器，历史域名不作为可用演示承诺。

- Key 保存在服务端，`/api/config` 只返回演示状态和公开模型信息。
- 真实模式将议题、公开发言和判断上下文发送给配置的模型；校对会发送正在编辑的文字。演示模式无需模型网络请求。
- 已有基础 IP 限流、输入大小限制与安全响应头，但没有账号、额度或持久化限流；公开运行需补充认证与预算限制。
- 模型行动提示不包含人类隐藏身份，不过客户端持有赛局状态，无法抵御修改浏览器数据的作弊行为，不适合竞技排名。

## 贡献和许可

欢迎提交 [Issue](https://github.com/mmy5067/Who_is_human-/issues) 或 PR；请阅读 [贡献指南](CONTRIBUTING.md)。安全问题按 [安全说明](SECURITY.md) 私下报告。

代码和仓库内项目资源按 [MIT License](LICENSE) 开源；依赖及模型服务仍遵循各自许可证与条款。

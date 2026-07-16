# 谁是人类？

一个四人社交图灵测试：三名独立 LLM Agent 寻找唯一的人类玩家，人类需要伪装成 AI 并活过两轮投票。

## 启动

1. 打开 `.env`，将三个 `YOUR_..._API_KEY_HERE` 替换成真实 Key。
2. 安装并在后台启动：

```bash
npm install
npm start
```

`npm start` 启动完成后会立即释放终端。浏览器访问 `http://localhost:3000`。

```bash
npm stop          # 手动关停
npm restart       # 重启服务
npm run status    # 查看状态
npm run logs      # 查看最近日志
npm run dev       # 开发模式：前台运行并热重载
```

Key 仍为占位符时会自动进入演示模式。若只想测试某个真实端点，请保证三个 Key 都已填写，或将 `DEMO_MODE=false`；任何单次模型请求失败都会在该行动上降级为安全发言，不会卡死整局。

## 游戏流程

每局开始时 MiMo 会单独调用一次，生成一个没有唯一答案的社会议题。第一回合中，玩家先介绍模型身份并从 AI 视角分析议题，再围绕其他玩家的议题立场公开盘问，随后匿名投票。人类若存活，第二回合会补充分析谁的议题讨论更像真实人类，再进行议题盘问和最终投票。人类被投出则立即失败；第二次投票后仍存活则获胜。

玩家每次编辑发言或回答时，可以使用“AI 检查错别字”获得一份不改变观点和口吻的校对建议，由玩家决定是否采用。赛后除了身份、模型、真实公开发言和判断摘要外，三个 AI 还会分别给出本局总结和对人类玩家伪装方式的评价。

为缩短整局等待时间，三个模型默认关闭深度思考，不展示内部思维链。

## 项目结构

服务端入口只负责 HTTP：

- `server.js`：路由、中间件与错误边界。
- `src/model-client.js`：三家 OpenAI 兼容接口的请求与 JSON 解析。
- `src/game/context.js`：玩家、聊天记录和逐轮赛果清洗。
- `src/game/prompts.js`：行动与赛后总结提示词。
- `src/game/action-result.js`：身份校验、目标解析和安全兜底。
- `src/game/mock.js`：演示模式 Agent。

浏览器端由 `public/app.js` 推进界面流程，`public/game-state.js` 保存纯状态初始化、洗牌和计票逻辑。纯游戏逻辑均可通过 `npm test` 独立验证。

## 公开部署提示

服务端不会向浏览器返回 API Key，并对 `/api` 请求提供了基础的 IP 限流、输入长度限制与安全响应头。部署在 Nginx、Cloudflare 等反向代理之后时，在 `.env` 设置 `TRUST_PROXY=true`，让限流读取真实客户端 IP。基础内存限流适合小规模网站；正式开放给大量用户前，建议换成 Redis 限流并增加登录、验证码或用量配额。

`.env` 已被 `.gitignore` 排除，API Key 不会被静态页面或 `/api/config` 暴露。

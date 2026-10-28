# 自部署指南

## 进程管理

需要 Node.js 22.18+（推荐 24 LTS）、npm，无需构建和数据库。先按 README 运行 `npm ci`、复制 `.env.example` 为 `.env`、填写配置并通过 `npm test`。

生产环境建议使用非 root 用户 `app` 和 systemd。假设代码位于 `/srv/who-is-human`，创建 `/etc/systemd/system/who-is-human.service`：

```ini
[Unit]
Description=Who Is Human
After=network.target

[Service]
Type=simple
User=app
WorkingDirectory=/srv/who-is-human
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

按实际 Node 安装位置调整 `ExecStart`。应用自动读取工作目录 `.env`，请限制文件权限。systemd 应直接使用 `node server.js` 或 `npm run serve`，不要使用自行转入后台的 `npm start`。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now who-is-human
sudo systemctl status who-is-human
sudo journalctl -u who-is-human -n 100 --no-pager
```

## 反向代理

将域名换为自己的域名。下面是证书申请前的 HTTP 配置，公开使用前应启用 HTTPS：

```nginx
server {
    listen 80;
    server_name human.example.com;
    client_max_body_size 200k;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }
}
```

示例假设只有一层可信 Nginx 代理，在 `.env` 设置 `TRUST_PROXY=true`。Node 当前监听所有接口，务必通过云安全组与系统防火墙禁止外部直连 3000；否则客户端可能伪造转发头。多层 CDN / 代理需按实际链路调整 Express 信任策略。

## 费用与状态

- 每局会多次请求三个模型，另有议题、校对和复盘请求，费用由部署者配置的服务商收取。
- `/api` 限流为每 IP 每 15 分钟 180 次，在单进程内存中保存，重启清空、实例之间不共享。
- `/api/config` 可检查演示状态，不验证模型连通性。
- 赛局保存在浏览器内存中，刷新页面会丢失；不提供账户和跨设备存档。
- 大范围公开需另加认证、配额和预算控制；不希望开放付费 API 时可以设 `DEMO_MODE=true`。

## 排错

| 现象 | 处理 |
| --- | --- |
| 填一个 Key 仍在演示模式 | `auto` 要求三个 Key 都有效，补齐后重启 |
| 模型不接受字段 | 调整 `src/model-client.js` 的 `requestBody` 中该槽位参数 |
| 超时或兜底发言 | 核对 Key、模型权限、地址和 `REQUEST_TIMEOUT_MS` |
| 所有人共用限流 | 检查真实客户端 IP 与 `TRUST_PROXY`，不要盲目信任转发头 |
| 后台日志 | `npm run logs` 或 `.runtime/server.log` |

修改 `.env` 后需要重启。systemd 与项目自带的后台进程管理器应选一种，避免端口冲突。

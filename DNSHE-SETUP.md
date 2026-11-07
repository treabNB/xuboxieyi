# DNSHE 域名接入

GitHub Pages 仓库：`treabNB/xuboxieyi`

GitHub Pages 默认地址：`https://treabnb.github.io/xuboxieyi/`

已配置的自定义域名：`xuboxieyi.cc.cd`

当前状态：DNS 已解析到 GitHub Pages，HTTP 页面已可访问；HTTPS 证书由 GitHub Pages 自动签发。

## DNSHE 记录

在 DNSHE 的 DNS 解析面板中添加：

```text
类型: CNAME
主机记录: @
记录值: treabnb.github.io
TTL: 600 或 Auto
```

如果当前 DNS 面板展示的是根域 `cc.cd`：

```text
类型: CNAME
主机记录: xuboxieyi
记录值: treabnb.github.io
TTL: 600 或 Auto
```

保存后等待 DNS 传播。GitHub Pages 会自动尝试签发 HTTPS 证书；证书签发完成后，在仓库的 **Settings → Pages → Custom domain** 中确认 `xuboxieyi.cc.cd`，并启用 **Enforce HTTPS**。

## API 方式

DNSHE V2 接口基址：

```text
https://api005.dnshe.com/index.php?m=domain_hub
```

认证需要 `X-API-Key` 和 `X-API-Secret`。先列出子域名，取得 `xuboxieyi.cc.cd` 对应的 `subdomain_id`，再调用：

```text
POST /index.php?m=domain_hub&endpoint=dns_records&action=create
{
  "subdomain_id": <DNSHE 返回的 ID>,
  "type": "CNAME",
  "name": "@",
  "content": "treabnb.github.io",
  "ttl": 600
}
```

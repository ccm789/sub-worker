# 私有订阅网关（Cloudflare Worker）

把私有仓库里的播放列表，通过「带密钥的地址」提供给播放器订阅。

## 部署步骤

1. 打开 https://dash.cloudflare.com → 注册/登录（免费）
2. 左侧 **Workers & Pages** → **Create** → **Worker** → 起名（如 `sub`）→ **Deploy**
3. 点 **Edit code**，全选删除，粘贴本仓库 `worker.js` 全部内容 → **Deploy**
4. 回到 Worker → **Settings** → **Variables and Secrets**，添加变量：
   - `KEYS` = 订阅密钥（多个用英文逗号分隔）
   - `GH_TOKEN` = 只读私有仓库的 GitHub Token
   - `GH_REPO` = `ccm789/sub-private`
   - `GH_PATH` = `list.m3u`
   - `GH_BRANCH` = `main`（可省略）
   - `BLOCK_BROWSER` = `1`
5. 订阅地址：`https://<worker域名>/?k=<密钥>`

## 行为

- 密钥不对 → 403；浏览器直接打开 → 403；单 IP 超 60 次/分钟 → 429
- 更换 `KEYS` → 所有旧链接立即失效
- 列表存于私有仓库 `sub-private/list.m3u`，GitHub 上任何人不可见

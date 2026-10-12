# 部署指南 (Deployment Guide)

本指南提供多种部署方式，包括 Docker 和传统 EC2 部署。

## 🐳 Docker 部署（推荐）

### 优势
- ✅ **环境隔离**：无需在主机安装 Node.js 和 npm
- ✅ **多阶段构建**：构建过程完全在容器内完成
- ✅ **一键部署**：简单快速，适合任何平台
- ✅ **易于维护**：统一的运行环境，减少"在我机器上能跑"的问题

### 前置要求
- 安装 Docker 和 Docker Compose
  - **Windows/Mac**: [Docker Desktop](https://www.docker.com/products/docker-desktop)
  - **Linux**: 
    ```bash
    # Ubuntu/Debian
    sudo apt update
    sudo apt install docker.io docker-compose -y
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo usermod -aG docker $USER  # 添加当前用户到 docker 组
    ```

### 快速开始

```bash
# 1. 克隆或上传项目到服务器
git clone https://github.com/your-username/guandan.git
cd guandan

# 2. 直接启动（Docker 会自动构建）
docker-compose up -d

# 3. 查看日志
docker-compose logs -f

# 4. 访问游戏
# 打开浏览器访问 http://your-server-ip:3000
```

### 常用命令

```bash
# 停止服务
docker-compose down

# 重启服务
docker-compose restart

# 查看运行状态
docker-compose ps

# 查看实时日志
docker-compose logs -f

# 更新代码后重新部署
git pull
docker-compose down
docker-compose up -d --build

# 清理旧镜像（释放空间）
docker system prune -a
```

### Dockerfile 说明

我们使用**多阶段构建**来优化镜像大小和安全性：

```dockerfile
# 阶段 1: 构建阶段（包含所有开发依赖）
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install  # 安装所有依赖（包括 devDependencies）
COPY . .
RUN npm run build  # 在容器内构建

# 阶段 2: 生产阶段（只包含运行时依赖）
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production  # 只安装生产依赖
COPY --from=builder /app/dist ./dist  # 从构建阶段复制产物
CMD ["node", "dist/server/index.js"]
```

**优势**：
- 最终镜像只包含生产依赖和构建产物
- 镜像体积更小（~150MB vs ~500MB）
- 更安全（不包含构建工具）

---

## 🖥️ EC2 传统部署

### 📋 前置要求

- 一个 AWS 账户
- 一个 EC2 实例（推荐 t2.micro 或更高配置）
- SSH 密钥对（用于连接 EC2）

## 🚀 部署步骤

### 1. 启动 EC2 实例

1. 登录 AWS 控制台，进入 EC2 服务
2. 点击 "Launch Instance"
3. 配置实例：
   - **AMI**: Ubuntu Server 22.04 LTS（或 Amazon Linux 2023）
   - **Instance Type**: t2.micro（免费套餐）或 t2.small
   - **Key Pair**: 创建或选择现有密钥对
   - **Security Group**: 配置以下规则：
     ```
     Type            Protocol    Port Range    Source
     SSH             TCP         22            Your IP (或 0.0.0.0/0)
     Custom TCP      TCP         3000          0.0.0.0/0
     ```
   - **Storage**: 默认 8GB 即可

4. 启动实例并记录公网 IP 地址

### 2. 连接到 EC2 实例

```bash
# Windows (使用 PowerShell 或 Git Bash)
ssh -i "your-key.pem" ubuntu@your-ec2-public-ip

# macOS/Linux
chmod 400 your-key.pem
ssh -i "your-key.pem" ubuntu@your-ec2-public-ip
```

### 3. 安装 Node.js 和依赖

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装 Node.js 18.x (推荐使用 nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18

# 验证安装
node --version
npm --version

# 安装 PM2 (进程管理器)
npm install -g pm2
```

### 4. 上传项目文件

**方法 A: 使用 Git（推荐）**

```bash
# 在 EC2 上
git clone https://github.com/your-username/guandan.git
cd guandan
npm install
npm run build
```

**方法 B: 使用 SCP 上传**

```bash
# 在本地电脑上
# 先在本地构建
npm run build

# 上传整个项目（不包括 node_modules）
scp -i "your-key.pem" -r ./dist ubuntu@your-ec2-public-ip:~/guandan/
scp -i "your-key.pem" package*.json ubuntu@your-ec2-public-ip:~/guandan/

# 然后在 EC2 上安装依赖
ssh -i "your-key.pem" ubuntu@your-ec2-public-ip
cd ~/guandan
npm install --production
```

### 5. 配置环境变量（可选）

```bash
# 创建 .env 文件
cat > .env << EOF
PORT=3000
NODE_ENV=production
EOF
```

### 6. 使用 PM2 启动服务

```bash
# 启动服务
pm2 start dist/server/index.js --name guandan-game

# 设置开机自启
pm2 startup
pm2 save

# 查看日志
pm2 logs guandan-game

# 查看状态
pm2 status
```

### 7. 配置 Nginx 反向代理（可选，推荐用于生产环境）

```bash
# 安装 Nginx
sudo apt install nginx -y

# 创建配置文件
sudo nano /etc/nginx/sites-available/guandan

# 添加以下内容：
```

```nginx
server {
    listen 80;
    server_name your-domain.com;  # 或使用 EC2 公网 IP

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

```bash
# 启用配置
sudo ln -s /etc/nginx/sites-available/guandan /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 8. 配置防火墙（如果使用 Nginx）

```bash
# 允许 HTTP/HTTPS
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
```

## 🌐 访问游戏

- **直接访问**: `http://your-ec2-public-ip:3000`
- **通过 Nginx**: `http://your-ec2-public-ip` 或 `http://your-domain.com`

## 🔧 常用管理命令

```bash
# PM2 管理
pm2 restart guandan-game    # 重启服务
pm2 stop guandan-game        # 停止服务
pm2 logs guandan-game        # 查看日志
pm2 monit                    # 监控资源使用

# 更新代码
cd ~/guandan
git pull
npm run build
pm2 restart guandan-game
```

## 📊 监控和维护

### 设置日志轮转

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### 监控服务器资源

```bash
# 安装 htop
sudo apt install htop -y
htop

# 查看磁盘使用
df -h

# 查看内存使用
free -h
```

## 🔒 安全建议

1. **限制 SSH 访问**：
   - 只允许特定 IP 访问 22 端口
   - 禁用密码登录，只使用密钥

2. **启用 HTTPS**（推荐使用 Let's Encrypt）：
   ```bash
   sudo apt install certbot python3-certbot-nginx -y
   sudo certbot --nginx -d your-domain.com
   ```

3. **定期更新系统**：
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

4. **配置自动备份**：
   - 使用 AWS Snapshots 定期备份 EBS 卷
   - 或使用 cron 定期备份重要数据

## 🐛 故障排查

### 服务无法启动

```bash
# 查看详细日志
pm2 logs guandan-game --lines 100

# 检查端口占用
sudo netstat -tulpn | grep 3000

# 手动启动测试
cd ~/guandan
node dist/server/index.js
```

### 无法访问游戏

1. 检查 EC2 安全组规则（端口 3000 是否开放）
2. 检查服务是否运行：`pm2 status`
3. 检查防火墙：`sudo ufw status`
4. 测试本地连接：`curl http://localhost:3000`

### Socket.IO 连接问题

- 确保安全组允许 WebSocket 连接
- 检查 Nginx 配置是否正确设置了 `Upgrade` 和 `Connection` 头

## 💰 成本估算

- **EC2 t2.micro**: 免费套餐（12 个月）或 ~$8/月
- **数据传输**: 前 1GB 免费，之后 $0.09/GB
- **EBS 存储**: 8GB ~$0.80/月

## 📝 自动化部署脚本

创建 `deploy.sh` 文件：

```bash
#!/bin/bash
set -e

echo "🚀 Starting deployment..."

# 拉取最新代码
git pull origin main

# 安装依赖
npm install

# 构建项目
npm run build

# 重启服务
pm2 restart guandan-game

echo "✅ Deployment completed!"
```

使用方法：
```bash
chmod +x deploy.sh
./deploy.sh
```

## 🆚 部署方式对比

| 特性 | Docker 部署 | PM2 部署 |
|------|------------|----------|
| **环境隔离** | ✅ 完全隔离 | ❌ 依赖主机环境 |
| **部署难度** | ⭐ 简单 | ⭐⭐ 中等 |
| **主机依赖** | 只需 Docker | 需要 Node.js + npm |
| **资源占用** | 稍高（~200MB） | 较低（~100MB） |
| **更新方式** | `docker-compose up -d --build` | `git pull && npm run build && pm2 restart` |
| **日志管理** | Docker logs | PM2 logs |
| **推荐场景** | 生产环境、多服务器 | 开发环境、单服务器 |

## 🔗 相关链接

- [Docker 文档](https://docs.docker.com/)
- [Docker Compose 文档](https://docs.docker.com/compose/)
- [AWS EC2 文档](https://docs.aws.amazon.com/ec2/)
- [PM2 文档](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [Nginx 文档](https://nginx.org/en/docs/)

---

**提示**: 
- **Docker 部署**：推荐用于生产环境，环境一致性好，易于扩展。
- **PM2 部署**：适合轻量级部署，资源占用更少。
- 如果您的团队分布在不同地区，建议选择离大多数玩家较近的 AWS 区域（如 `ap-southeast-1` 新加坡 或 `ap-northeast-1` 东京）以降低延迟。


## 牌局持久化与重启恢复

服务默认把房间与正在进行的牌局保存在工作目录的 `data/rooms.json`。可通过环境变量 `GUANDAN_DATA_DIR` 指定绝对路径，例如：

```bash
GUANDAN_DATA_DIR=/var/lib/guandan PORT=3000 node dist/server/index.js
```

- 普通和技能模式都保存：所有手牌、技能卡、当前回合、桌面牌、进贡/还贡、排名、历史、当前局数，以及整场升级与连胜进度。客户端仍只收到自己的手牌与技能，其他玩家只显示张数。
- 每次状态变化同步写临时文件并刷盘，再原子替换存档；不依赖退出钩子，因此进程被强制终止后也能恢复已保存的进度。SIGINT/SIGTERM 会在退出前保存。
- 重启后不会重新洗牌，也不会让机器人在无人上线时悄悄打完整场。玩家用原房间号、原昵称重连。第一位真人重连后留 15 秒缓冲，之后机器人和仍未回来的玩家继续托管；真人在缓冲期也可操作。结算中的牌局在恢复后进入下一局，不会重复升级。
- 结束整场或房主强制结束会清除牌局存档，仍在线的玩家回到等候房间。等候房间的玩家重启后需要重新准备；主动离开的空房间会删除。
- Docker Compose 已挂载命名卷 `guandan-data`。普通 `down` / 重建容器保留存档；`down -v` 会删除卷和牌局。直接运行 Docker 时也必须挂载 `/app/data`（并设置 `GUANDAN_DATA_DIR=/app/data`）。临时容器文件系统或更换服务器不会自动迁移数据。
- 仅支持一个 Node 服务进程写同一目录；不要使用 PM2 cluster、多副本或共享网络文件系统。横向扩容需要另做数据库与并发控制。
- 存档含所有隐藏手牌，目录必须放在静态资源目录之外，只授权服务账户访问；不要提交 Git、打入镜像、公开下载或把存档内容写日志。文件使用仅所有者可读写的权限。备份需使用同等访问保护。
- 存档损坏、版本不支持或磁盘不可写会让服务明确报错并停止，不会静默丢弃原牌局。修复权限/磁盘后重新启动；损坏时先保留原文件，再从可信备份恢复。没有备份只能在明确接受丢失牌局后移走文件重新开始。
- 继续沿用局域网同名重连机制，没有新增身份认证。知道房间号和已断线昵称的人仍可能接管该座位；请在可信局域网使用，不要把它当作公开互联网账号系统。

`npm run check` 包含真实服务进程被强制终止后的重启测试。存档格式带版本号，升级不兼容格式时必须先实现显式迁移。

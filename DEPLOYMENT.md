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

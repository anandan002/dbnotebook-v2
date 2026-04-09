# Server Deployment Guide (Linux, Without Docker)

This guide is **Linux-focused** (Ubuntu, Azure VM, AWS EC2, etc.).

For Windows/macOS workflows and service alternatives, start with [Cross-Platform Deployment](CROSS_PLATFORM_DEPLOYMENT.md).

Deploy DBNotebook on Linux using `scripts/sh/dev.sh local` for development or `scripts/sh/prod.sh start` for production process management.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Server Setup (Ubuntu/Debian)](#server-setup-ubuntudebian)
4. [Azure VM Deployment](#azure-vm-deployment)
5. [PostgreSQL + pgvector Setup](#postgresql-pgvector-setup)
6. [Application Installation](#application-installation)
7. [Environment Configuration](#environment-configuration)
8. [Running the Application](#running-the-application)
9. [Production Deployment](#production-deployment)
10. [Systemd Service](#systemd-service)
11. [Nginx Reverse Proxy](#nginx-reverse-proxy)
12. [SSL/TLS with Let's Encrypt](#ssltls-with-lets-encrypt)
13. [Monitoring & Maintenance](#monitoring-maintenance)
14. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Minimum Server Requirements

| Resource | Development | Production |
|----------|------------|------------|
| CPU | 2 cores | 4+ cores |
| RAM | 4 GB | 8+ GB |
| Storage | 20 GB | 50+ GB SSD |
| OS | Ubuntu 22.04+ | Ubuntu 22.04 LTS |

### Required Software

- Python 3.11 or 3.12
- PostgreSQL 15+ with pgvector extension
- Node.js 18+ (for frontend build)
- Git

---

## Quick Start

For those familiar with the setup, here's the minimal sequence:

```bash
# 1. Clone repository
git clone https://github.com/beedev/dbnotebook-v2.git
cd dbn-v2

# 2. Install Python 3.11
sudo apt install python3.11 python3.11-venv python3.11-dev

# 3. Setup PostgreSQL + pgvector
sudo apt install postgresql-15 postgresql-server-dev-15
git clone --branch v0.7.0 https://github.com/pgvector/pgvector.git
cd pgvector && make && sudo make install && cd ..

# 4. Create database
sudo -u postgres psql -c "CREATE USER dbnotebook WITH PASSWORD 'dbnotebook';"
sudo -u postgres psql -c "CREATE DATABASE dbnotebook_dev OWNER dbnotebook;"
sudo -u postgres psql -d dbnotebook_dev -c "CREATE EXTENSION vector;"

# 5. Setup Python environment
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 6. Configure environment
cp .env.example .env
# Edit .env with your API keys and database settings

# 7. Build frontend
cd frontend && npm install && npm run build && cd ..

# 8. Run database migrations
PYTHONPATH=. alembic upgrade head

# 9. Start application
./scripts/sh/dev.sh local  # Development mode
# OR
gunicorn -w 4 -b 0.0.0.0:7860 "dbnotebook.ui.web:create_app()"  # Production
```

---

## Server Setup (Ubuntu/Debian)

### Update System

```bash
sudo apt update && sudo apt upgrade -y
```

### Install System Dependencies

```bash
# Essential build tools
sudo apt install -y build-essential git curl wget

# Python 3.11
sudo apt install -y software-properties-common
sudo add-apt-repository ppa:deadsnakes/ppa -y
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3.11-dev python3-pip

# Node.js 18+ (for frontend build)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Additional libraries for ML models
sudo apt install -y libopenblas-dev libomp-dev
```

### Create Application User (Optional but Recommended)

```bash
# Create dedicated user for the application
sudo useradd -m -s /bin/bash dbnotebook
sudo usermod -aG sudo dbnotebook

# Switch to application user
sudo su - dbnotebook
```

---

## Azure VM Deployment

### Create Azure VM

1. **Portal**: Create VM → Ubuntu 22.04 LTS → Standard_D2s_v3 (2 vCPU, 8 GB) or larger
2. **Networking**: Open ports 22 (SSH), 80 (HTTP), 443 (HTTPS), 7860 (optional for direct access)
3. **Storage**: 64 GB Premium SSD recommended

### Azure CLI (Alternative)

```bash
# Create resource group
az group create --name dbnotebook-rg --location eastus

# Create VM
az vm create \
  --resource-group dbnotebook-rg \
  --name dbnotebook-vm \
  --image Ubuntu2204 \
  --size Standard_D2s_v3 \
  --admin-username azureuser \
  --generate-ssh-keys \
  --public-ip-sku Standard

# Open ports
az vm open-port --resource-group dbnotebook-rg --name dbnotebook-vm --port 80
az vm open-port --resource-group dbnotebook-rg --name dbnotebook-vm --port 443
az vm open-port --resource-group dbnotebook-rg --name dbnotebook-vm --port 7860
```

### SSH into VM

```bash
ssh azureuser@<VM_PUBLIC_IP>
```

---

## PostgreSQL + pgvector Setup

### Install PostgreSQL 15

```bash
# Add PostgreSQL APT repository
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -

# Install PostgreSQL
sudo apt update
sudo apt install -y postgresql-15 postgresql-contrib-15 postgresql-server-dev-15
```

### Install pgvector Extension

```bash
# Clone and build pgvector
git clone --branch v0.7.0 https://github.com/pgvector/pgvector.git
cd pgvector
make
sudo make install
cd ..
rm -rf pgvector
```

### Configure Database

```bash
# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create user and database
sudo -u postgres psql << EOF
CREATE USER dbnotebook WITH PASSWORD 'your_secure_password';
CREATE DATABASE dbnotebook_dev OWNER dbnotebook;
\c dbnotebook_dev
CREATE EXTENSION vector;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO dbnotebook;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO dbnotebook;
EOF
```

### Configure Password Authentication

Edit `/etc/postgresql/15/main/pg_hba.conf`:

```bash
sudo nano /etc/postgresql/15/main/pg_hba.conf
```

Add these lines before `local all all peer`:

```
# DBNotebook user
local   all             dbnotebook                              md5
host    all             dbnotebook      127.0.0.1/32            md5
host    all             dbnotebook      ::1/128                 md5
```

Restart PostgreSQL:

```bash
sudo systemctl restart postgresql
```

### Verify Installation

```bash
# Test connection
psql -h localhost -U dbnotebook -d dbnotebook_dev -c "SELECT '[1,2,3]'::vector;"
```

---

## Application Installation

### Clone Repository

```bash
cd /opt  # or /home/dbnotebook
sudo git clone https://github.com/beedev/dbnotebook-v2.git dbnotebook
sudo chown -R $USER:$USER dbnotebook
cd dbnotebook
```

### Setup Python Virtual Environment

```bash
python3.11 -m venv venv
source venv/bin/activate

# Upgrade pip
pip install --upgrade pip wheel setuptools

# Install dependencies (takes 5-10 minutes)
pip install -r requirements.txt
```

### Build Frontend

```bash
cd frontend
npm install
npm run build
cd ..
```

---

## Environment Configuration

### Create .env File

```bash
cp .env.example .env
nano .env
```

### Essential Configuration

```bash
# ===========================================
# DATABASE CONFIGURATION
# ===========================================
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=dbnotebook_dev
POSTGRES_USER=dbnotebook
POSTGRES_PASSWORD=your_secure_password

# ===========================================
# LLM PROVIDER (Choose one)
# ===========================================
# Option 1: OpenAI (Recommended for production)
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your-api-key
LLM_MODEL=gpt-4.1-mini

# Option 2: Groq (Fast inference, free tier available)
# LLM_PROVIDER=groq
# GROQ_API_KEY=gsk_your-api-key
# LLM_MODEL=meta-llama/llama-4-maverick-17b-128e-instruct

# Option 3: Anthropic
# LLM_PROVIDER=anthropic
# ANTHROPIC_API_KEY=your-api-key
# LLM_MODEL=claude-3-haiku-20240307

# Option 4: Ollama (Self-hosted, requires separate Ollama installation)
# LLM_PROVIDER=ollama
# OLLAMA_HOST=http://localhost:11434
# LLM_MODEL=llama3.1:latest

# ===========================================
# EMBEDDING PROVIDER
# ===========================================
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
PGVECTOR_EMBED_DIM=1536

# ===========================================
# RETRIEVAL SETTINGS
# ===========================================
RETRIEVAL_STRATEGY=hybrid
CONTEXT_WINDOW=128000
CHAT_TOKEN_LIMIT=32000

# ===========================================
# VISION & IMAGE (Optional)
# ===========================================
VISION_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-api-key

# ===========================================
# AUTHENTICATION
# ===========================================
FLASK_SECRET_KEY=generate-a-long-random-string-here
API_KEY=your-api-key-for-programmatic-access

# ===========================================
# WEB SEARCH (Optional)
# ===========================================
# FIRECRAWL_API_KEY=your-firecrawl-key
# JINA_API_KEY=your-jina-key
```

### Generate Secure Keys

```bash
# Generate FLASK_SECRET_KEY
python3 -c "import secrets; print(secrets.token_hex(32))"

# Generate API_KEY
python3 -c "import secrets; print('dbn_' + secrets.token_hex(16))"
```

---

## Running the Application

### Option 1: Production Script (Recommended)

Use `scripts/sh/prod.sh` for production deployments on Linux servers:

```bash
cd /opt/dbnotebook

# Start in background
./scripts/sh/prod.sh start

# Check status
./scripts/sh/prod.sh status

# View logs
./scripts/sh/prod.sh logs

# Stop
./scripts/sh/prod.sh stop

# Restart
./scripts/sh/prod.sh restart

# Health check
./scripts/sh/prod.sh health
```

**What scripts/sh/prod.sh does:**
1. Loads environment variables from `.env`
2. Activates the virtual environment
3. Runs Alembic database migrations
4. Starts Flask with threading in background (`nohup`)
5. Manages PID file for process tracking
6. Logs to `logs/app.log` and `logs/error.log`

**Access the application:**
- Local: http://localhost:7860
- Remote: http://YOUR_SERVER_IP:7860

### Option 2: Manual Start (More Control)

```bash
cd /opt/dbnotebook
source venv/bin/activate

# Load environment variables
export $(grep -v '^#' .env | xargs)

# Run migrations
PYTHONPATH=. alembic upgrade head

# Start Flask with threading (foreground)
PYTHONPATH=. python3 -m flask --app "dbnotebook.ui.web:create_app()" run --host 0.0.0.0 --port 7860 --with-threads
```

---

## Production Deployment

For production, use `scripts/sh/prod.sh` which runs Flask with threading. This provides better compatibility with the app's SSE streaming and long-running LLM requests.

### Using scripts/sh/prod.sh (Recommended)

```bash
# Start application in background
./scripts/sh/prod.sh start

# The script handles:
# - Environment loading
# - Database migrations
# - Background process management
# - Logging to logs/ directory
# - PID tracking for stop/restart
```

### Alternative: Gunicorn with gevent

If you prefer Gunicorn, use gevent workers for better async handling:

```bash
pip install gunicorn gevent

gunicorn -k gevent -w 4 --worker-connections 1000 \
  -b 0.0.0.0:7860 \
  --timeout 180 \
  --access-logfile /var/log/dbnotebook/access.log \
  --error-logfile /var/log/dbnotebook/error.log \
  "dbnotebook.ui.web:create_app()"
```

**Note**: Standard Gunicorn sync workers may cause issues with SSE streaming and long LLM requests. Use `gevent` workers or stick with `scripts/sh/prod.sh`.

---

## Systemd Service

Create a systemd service for automatic startup and management.

### Create Service File

```bash
sudo nano /etc/systemd/system/dbnotebook.service
```

```ini
[Unit]
Description=DBNotebook RAG Application
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=dbnotebook
Group=dbnotebook
WorkingDirectory=/opt/dbnotebook
Environment="PATH=/opt/dbnotebook/venv/bin"
Environment="PYTHONPATH=/opt/dbnotebook"
EnvironmentFile=/opt/dbnotebook/.env
ExecStart=/opt/dbnotebook/venv/bin/python3 -m flask \
    --app "dbnotebook.ui.web:create_app()" \
    run \
    --host 0.0.0.0 \
    --port 7860 \
    --with-threads
Restart=always
RestartSec=10
StandardOutput=append:/var/log/dbnotebook/app.log
StandardError=append:/var/log/dbnotebook/error.log

[Install]
WantedBy=multi-user.target
```

### Create Log Directory

```bash
sudo mkdir -p /var/log/dbnotebook
sudo chown dbnotebook:dbnotebook /var/log/dbnotebook
```

### Enable and Start Service

```bash
sudo systemctl daemon-reload
sudo systemctl enable dbnotebook
sudo systemctl start dbnotebook

# Check status
sudo systemctl status dbnotebook

# View logs
sudo journalctl -u dbnotebook -f
```

### Service Management Commands

```bash
# Start/stop/restart
sudo systemctl start dbnotebook
sudo systemctl stop dbnotebook
sudo systemctl restart dbnotebook

# View logs
sudo journalctl -u dbnotebook -f
sudo journalctl -u dbnotebook --since "1 hour ago"

# Reload after configuration changes
sudo systemctl daemon-reload
sudo systemctl restart dbnotebook
```

---

## Nginx Reverse Proxy

Use Nginx as a reverse proxy for SSL termination, static file serving, and load balancing.

### Install Nginx

```bash
sudo apt install -y nginx
```

### Configure Nginx

```bash
sudo nano /etc/nginx/sites-available/dbnotebook
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL certificates (configure after Let's Encrypt setup)
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    # Logging
    access_log /var/log/nginx/dbnotebook_access.log;
    error_log /var/log/nginx/dbnotebook_error.log;

    # Max upload size (for document uploads)
    client_max_body_size 100M;

    # Proxy settings
    location / {
        proxy_pass http://127.0.0.1:7860;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts for long-running requests (LLM generation)
        proxy_connect_timeout 120s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }

    # Server-Sent Events (SSE) for streaming responses
    location /chat {
        proxy_pass http://127.0.0.1:7860;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 3600s;
    }

    # Static files (optional - served by Flask)
    location /static {
        alias /opt/dbnotebook/dbnotebook/ui/static;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
```

### Enable Site

```bash
sudo ln -s /etc/nginx/sites-available/dbnotebook /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default  # Remove default site
sudo nginx -t  # Test configuration
sudo systemctl restart nginx
```

---

## SSL/TLS with Let's Encrypt

### Install Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
```

### Obtain Certificate

```bash
sudo certbot --nginx -d your-domain.com
```

### Auto-Renewal

Certbot automatically adds a cron job. Verify:

```bash
sudo certbot renew --dry-run
```

---

## Monitoring & Maintenance

### Health Check Endpoint

Test the application is running:

```bash
curl http://localhost:7860/api/health
```

### Log Rotation

Create `/etc/logrotate.d/dbnotebook`:

```
/var/log/dbnotebook/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 dbnotebook dbnotebook
    sharedscripts
    postrotate
        systemctl reload dbnotebook > /dev/null 2>&1 || true
    endscript
}
```

### Database Backup

```bash
# Create backup script
cat << 'EOF' > /opt/dbnotebook/scripts/backup.sh
#!/bin/bash
BACKUP_DIR="/var/backups/dbnotebook"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

pg_dump -h localhost -U dbnotebook -d dbnotebook_dev | gzip > $BACKUP_DIR/dbnotebook_$TIMESTAMP.sql.gz

# Keep only last 7 days
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete
EOF

chmod +x /opt/dbnotebook/scripts/backup.sh

# Add to crontab (daily at 2 AM)
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/dbnotebook/scripts/backup.sh") | crontab -
```

### Update Application

```bash
cd /opt/dbnotebook

# Pull latest code
git pull origin main

# Update dependencies
source venv/bin/activate
pip install -r requirements.txt

# Rebuild frontend
cd frontend && npm install && npm run build && cd ..

# Run migrations
PYTHONPATH=. alembic upgrade head

# Restart service
sudo systemctl restart dbnotebook
```

---

## Troubleshooting

### Common Issues

#### Application Won't Start

```bash
# Check logs
sudo journalctl -u dbnotebook -n 50

# Check if port is in use
sudo lsof -i :7860

# Test manually
cd /opt/dbnotebook
source venv/bin/activate
export $(grep -v '^#' .env | xargs)
PYTHONPATH=. python -m dbnotebook.ui.web
```

#### Database Connection Failed

```bash
# Test PostgreSQL connection
psql -h localhost -U dbnotebook -d dbnotebook_dev -c "SELECT 1;"

# Check PostgreSQL is running
sudo systemctl status postgresql

# Check pg_hba.conf
sudo cat /etc/postgresql/15/main/pg_hba.conf | grep dbnotebook
```

#### pgvector Extension Error

```bash
# Verify extension is installed
psql -h localhost -U dbnotebook -d dbnotebook_dev -c "SELECT * FROM pg_extension WHERE extname = 'vector';"

# If not, create it
psql -h localhost -U postgres -d dbnotebook_dev -c "CREATE EXTENSION vector;"
```

#### Memory Issues

```bash
# Check memory usage
free -h

# If low, reduce Gunicorn workers
# In /etc/systemd/system/dbnotebook.service, change -w 4 to -w 2
```

#### LLM API Errors

```bash
# Test API key
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# Check rate limits in logs
grep -i "rate limit" /var/log/dbnotebook/error.log
```

### Performance Tuning

#### PostgreSQL

Edit `/etc/postgresql/15/main/postgresql.conf`:

```ini
# Memory
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 64MB

# Connections
max_connections = 100

# Logging
log_statement = 'none'
log_min_duration_statement = 1000
```

#### Gunicorn

For high-traffic deployments:

```bash
gunicorn -w 8 -k gevent --worker-connections 1000 \
  -b 0.0.0.0:7860 "dbnotebook.ui.web:create_app()"
```

---

## Quick Reference

### File Locations

| Item | Path |
|------|------|
| Application | `/opt/dbnotebook` |
| Virtual environment | `/opt/dbnotebook/venv` |
| Configuration | `/opt/dbnotebook/.env` |
| Logs | `/var/log/dbnotebook/` |
| Systemd service | `/etc/systemd/system/dbnotebook.service` |
| Nginx config | `/etc/nginx/sites-available/dbnotebook` |
| Database backups | `/var/backups/dbnotebook/` |

### Service Commands

```bash
# DBNotebook
sudo systemctl {start|stop|restart|status} dbnotebook

# PostgreSQL
sudo systemctl {start|stop|restart|status} postgresql

# Nginx
sudo systemctl {start|stop|restart|status} nginx
```

### Useful Commands

```bash
# Check application logs
sudo journalctl -u dbnotebook -f

# Check database size
psql -h localhost -U dbnotebook -d dbnotebook_dev -c "SELECT pg_size_pretty(pg_database_size('dbnotebook_dev'));"

# Count documents
psql -h localhost -U dbnotebook -d dbnotebook_dev -c "SELECT COUNT(*) FROM data_embeddings;"

# Restart after config changes
sudo systemctl daemon-reload && sudo systemctl restart dbnotebook
```

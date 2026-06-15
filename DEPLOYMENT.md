# Admissions Officer — Deployment Guide

## Prerequisites

- **Node.js** ≥ 18.0.0 (check with `node -v`)
- **npm** (bundled with Node.js)
- **GEMINI_API_KEY** from [Google AI Studio](https://aistudio.google.com/app/apikey)

## Quick Start

### 1. Local Development Deployment

```bash
# Clone or navigate to project directory
cd /path/to/admissions-officer

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# - Set GEMINI_API_KEY (required)
# - Set GEMINI_MODEL (default: gemini-2.5-flash-lite)
# - Optionally set PORT (default: 3000)
nano .env

# Run deployment script
./deploy.sh

# Server will start on http://localhost:3000
```

### 2. Quick Test

```bash
# Verify server is running
curl http://localhost:3000/

# Expected output: HTML of the Admissions Officer app
```

## Production Deployment

### Option A: Manual Systemd Service

```bash
# 1. Create service user
sudo useradd -r -s /bin/false ao-app

# 2. Copy application to /opt
sudo cp -r . /opt/admissions-officer
sudo chown -R ao-app:ao-app /opt/admissions-officer

# 3. Install systemd service
sudo cp admissions-officer.service /etc/systemd/system/

# 4. Configure environment
sudo nano /opt/admissions-officer/.env
# - Set GEMINI_API_KEY
# - Set DATA_DIR to a persistent location
# - Set PORT (default: 3000)

# 5. Install dependencies
cd /opt/admissions-officer
sudo -u ao-app npm install --omit=dev

# 6. Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable admissions-officer
sudo systemctl start admissions-officer

# 7. Check status
sudo systemctl status admissions-officer

# View logs
sudo journalctl -u admissions-officer -f
```

### Option B: Docker Deployment

Create a `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev --ignore-scripts

# Copy application
COPY . .

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

# Start service
CMD ["node", "bin/cli.js"]
```

Deploy with Docker:

```bash
# Build image
docker build -t admissions-officer:1.1.2 .

# Run container
docker run \
  -d \
  --name admissions-officer \
  -p 3000:3000 \
  -e GEMINI_API_KEY="your-api-key-here" \
  -e GEMINI_MODEL="gemini-2.5-flash-lite" \
  -v ao-data:/ao-profile \
  admissions-officer:1.1.2

# View logs
docker logs -f admissions-officer
```

### Option C: PM2 Process Manager

```bash
# Install PM2 globally
npm install -g pm2

# Create ecosystem.config.js
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'admissions-officer',
    script: 'bin/cli.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
    log_file: 'logs/combined.log',
    time_format: 'YYYY-MM-DD HH:mm:ss Z',
    watch: false,
    max_memory_restart: '512M',
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
EOF

# Start with PM2
pm2 start ecosystem.config.js

# Setup auto-start on reboot
pm2 startup
pm2 save

# View logs
pm2 logs admissions-officer

# Monitor
pm2 monit
```

## Environment Variables

### Required

- **GEMINI_API_KEY**: Your Google Gemini API key
  - Get from: https://aistudio.google.com/app/apikey
  - Set once, used for all AI operations

### Optional

- **GEMINI_MODEL**: Gemini model to use
  - Default: `gemini-2.5-flash-lite`
  - Options: See [Google AI docs](https://ai.google.dev/models)

- **PORT**: HTTP server port
  - Default: `3000`
  - Example: `PORT=8080`

- **DATA_DIR**: Profile data directory (set automatically)
  - Auto-created: `~/ao-profile`
  - Override to use custom location

## Deployment Script Options

```bash
# Show help
./deploy.sh --help

# Dry-run (shows what would happen)
./deploy.sh --dry-run

# Custom port
./deploy.sh --port 8080

# Check prerequisites
./deploy.sh --check-only
```

## Health Checks

### Local

```bash
# Check if server is running
curl http://localhost:3000/

# Expected: HTTP 200 with HTML response
```

### Systemd

```bash
# Check service status
sudo systemctl status admissions-officer

# View recent logs
sudo journalctl -u admissions-officer -n 50

# Restart service
sudo systemctl restart admissions-officer
```

### Docker

```bash
# Check container health
docker ps | grep admissions-officer

# View logs
docker logs admissions-officer

# Restart container
docker restart admissions-officer
```

## Troubleshooting

### Port Already in Use

```bash
# Find process using the port
lsof -i :3000

# Or with netstat
netstat -tulpn | grep 3000

# Kill the process
kill -9 <PID>
```

### API Key Not Working

```bash
# Verify .env is correctly formatted
cat .env

# Check that GEMINI_API_KEY is set
echo $GEMINI_API_KEY

# Verify API key is valid at https://aistudio.google.com/app/apikey
```

### Data Directory Issues

```bash
# Check data directory exists and is writable
ls -la ~/ao-profile

# Ensure proper permissions
chmod 755 ~/ao-profile

# Or change DATA_DIR to a custom location
export DATA_DIR=/var/lib/ao-data
```

### Memory Issues

```bash
# Check available memory
free -h

# Limit Node.js memory
node --max-old-space-size=512 bin/cli.js

# Or use systemd MemoryLimit (in service file)
```

## Monitoring & Logs

### View Real-time Logs

```bash
# Systemd
sudo journalctl -u admissions-officer -f

# Docker
docker logs -f admissions-officer

# PM2
pm2 logs admissions-officer
```

### Log Rotation (Systemd)

Logs are automatically managed by journald. To limit size:

```bash
# View journal config
journalctl --help | grep -i "max"

# Set max journal size (in /etc/systemd/journald.conf)
SystemMaxUse=1G
```

## Updates & Upgrades

```bash
# Stop service
sudo systemctl stop admissions-officer

# Pull latest code (if using git)
git pull origin main

# Install dependencies
npm install --omit=dev

# Start service
sudo systemctl start admissions-officer

# Check status
sudo systemctl status admissions-officer
```

## Security Recommendations

1. **API Key Management**
   - Use environment variables, never hardcode keys
   - Rotate keys regularly
   - Restrict API key permissions in Google Cloud Console

2. **Data Directory**
   - Store in non-web-accessible location
   - Backup regularly: `tar -czf ao-profile.tar.gz ~/ao-profile`
   - Restrict file permissions: `chmod 700 ~/ao-profile`

3. **Network**
   - Use HTTPS/TLS in production (with nginx/Apache reverse proxy)
   - Restrict access to trusted IPs if needed
   - Use firewall rules

4. **Monitoring**
   - Set up log aggregation (e.g., ELK stack)
   - Monitor disk space and memory usage
   - Alert on service failures

## Support

For issues or questions:
- Check the main README.md
- Review application logs
- Verify prerequisites are installed
- Ensure .env is properly configured

---

**Version**: 1.1.2  
**Last Updated**: 2026-06-15

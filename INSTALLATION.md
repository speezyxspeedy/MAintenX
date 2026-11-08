# MaintenX Installation & Deployment Guide
> **Complete Operations Manual for On-Premise, Cloud, and Air-Gapped Industrial Environments**

This guide provides end-to-end instructions for deploying **MaintenX** across local machines, workshop intranet servers, Docker containers, and static hosting platforms.

---

## 1. System Requirements

### Client Browsers
- Google Chrome 90+ (Windows, macOS, Linux, Android)
- Microsoft Edge 90+ (Windows 10/11)
- Mozilla Firefox 88+
- Apple Safari 14+ (macOS, iOS, iPadOS)

### Server Requirements (Static Web Server Only)
Because MaintenX executes 100% client-side with IndexedDB, no server-side application runtimes (Node.js, Python, PHP, or SQL databases) are required in production.
- **CPU**: Any x86/ARM hardware (even a Raspberry Pi 4).
- **RAM**: Minimal (< 50MB for static file serving).
- **Disk Space**: ~15MB for static files.

---

## 2. Local Development & Quick Start

### Option A: Using Vite / Node.js
```bash
# 1. Clone or extract the project repository
cd MaintenX

# 2. Install development tools
npm install

# 3. Start the Vite development server
npm run dev
```
Navigate to `http://localhost:3000` in your web browser.

To create an optimized production build:
```bash
npm run build
```
This produces optimized static assets in the `dist/` directory.

---

### Option B: Zero-Dependency Python Server (No Node.js Required)
MaintenX can run directly from source without any build step:

**Windows 11 / macOS / Linux**:
```bash
python3 -m http.server 8080
# or on Windows:
python -m http.server 8080
```
Open `http://localhost:8080`.

---

### Option C: VS Code Live Server
1. Launch **Visual Studio Code**.
2. Open the `MaintenX` folder (`File > Open Folder...`).
3. Install the **Live Server** extension (by Ritwick Dey).
4. Right-click `index.html` and select **"Open with Live Server"**.
5. Your default browser will open at `http://127.0.0.1:5500`.

---

## 3. Production Deployment Options

### Option 1: Docker (Alpine Nginx)

Create a `Dockerfile` in the root directory:

```dockerfile
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

Build and run the container:
```bash
# Build the image
docker build -t maintenx-cmms:1.0 .

# Run container on port 8080
docker run -d --name maintenx -p 8080:80 maintenx-cmms:1.0
```
Access the application at `http://<server-ip>:8080`.

---

### Option 2: Nginx Web Server Configuration

When deploying on an on-premise Linux machine (Ubuntu, Debian, RHEL) with Nginx:

1. Copy the project files to `/var/www/maintenx`:
   ```bash
   sudo mkdir -p /var/www/maintenx
   sudo cp -r . /var/www/maintenx/
   sudo chown -R www-data:www-data /var/www/maintenx
   ```

2. Create `/etc/nginx/sites-available/maintenx`:
   ```nginx
   server {
       listen 80;
       server_name maintenx.local cmms.internal.plant;

       root /var/www/maintenx;
       index index.html;

       # Security Headers
       add_header X-Content-Type-Options "nosniff" always;
       add_header X-Frame-Options "SAMEORIGIN" always;
       add_header X-XSS-Protection "1; mode=block" always;
       add_header Referrer-Policy "strict-origin-when-cross-origin" always;

       # Service Worker & Manifest caching policy
       location /sw.js {
           add_header Cache-Control "no-cache";
           expires 0;
       }

       location /manifest.json {
           add_header Cache-Control "max-age=86400";
       }

       # Static assets
       location ~* \.(css|js|svg|png|jpg|ico)$ {
           expires 7d;
           add_header Cache-Control "public, no-transform";
       }

       # Single Page Application routing fallback
       location / {
           try_files $uri $uri/ /index.html;
       }
   }
   ```

3. Enable the site and restart Nginx:
   ```bash
   sudo ln -s /etc/nginx/sites-available/maintenx /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

---

### Option 3: Cloud Platforms (Vercel, Netlify, Cloudflare Pages, GitHub Pages)

MaintenX is fully compatible with one-click static cloud deployment:

- **Vercel**: Run `vercel --prod` or link your Git repository. Set Build Command to `npm run build` (or leave empty if deploying root) and Output Directory to `dist`.
- **Netlify**: Publish directory `dist` or root `/`.
- **Cloudflare Pages**: Connect Git, set Build output directory to `dist`.
- **GitHub Pages**: Go to Repository Settings > Pages > Select `main` branch root `/` or `/dist`.

---

## 4. Air-Gapped Industrial Intranet Setup

For high-security manufacturing plants, defense facilities, or isolated workshops with no internet access:

1. Copy the entire `MaintenX` folder to an on-premise machine or industrial workstation.
2. Configure a local DNS entry (e.g. `maintenx.plant.local` pointing to the server's LAN IP).
3. Ensure HTTPS is configured if accessing from remote tablets across the plant floor (Service Workers and Notification APIs require a secure origin: `localhost`, `127.0.0.1`, or `https://*`).
4. Generate an internal SSL certificate using `mkcert` or your plant's internal Certificate Authority:
   ```bash
   mkcert -install
   mkcert maintenx.plant.local
   ```

---

## 5. PWA Installation (Desktop & Mobile)

MaintenX can be installed as a native-feeling standalone application:

- **Windows 11 / macOS (Chrome or Edge)**:
  1. Navigate to the MaintenX web address.
  2. Click the **"Install MaintenX"** icon in the browser address bar (top right).
  3. MaintenX will appear as an independent application window with its own taskbar/dock icon.
- **iPad / iPhone (Safari)**:
  1. Open MaintenX in Safari.
  2. Tap the **Share** button (box with upward arrow).
  3. Tap **"Add to Home Screen"**.
- **Android Tablets & Phones (Chrome)**:
  1. Tap the three-dot menu icon in Chrome.
  2. Select **"Install app"** or **"Add to Home screen"**.

---

## 6. Backup Automation & Data Disaster Recovery

Because all operational information is maintained in the user's browser IndexedDB:

1. **Daily / Weekly Backup**:
   - Instruct maintenance supervisors to open `Settings & RBAC > Local Data Backup & Restore`.
   - Click **"Download Full JSON Backup"**.
   - Store the timestamped JSON file on a secure shared network drive or external backup storage.
2. **Restoring on a New Device or Browser**:
   - Open MaintenX on the new computer or tablet.
   - Go to `Settings > Restore from Backup`.
   - Select the JSON backup file and confirm the restore. All 11 object stores will be restored instantly.

---

## 7. Troubleshooting

| Issue | Likely Cause | Solution |
| :--- | :--- | :--- |
| **"Notifications permission denied"** | Browser blocked notifications or non-secure origin. | Notifications require `https://` or `localhost`. Click the padlock in the address bar and enable notifications. |
| **"Service Worker registration failed"** | Running over unencrypted HTTP on a LAN IP. | Browsers restrict Service Workers on plain IP addresses (e.g. `http://192.168.1.50`). Use `localhost` or install an SSL certificate. |
| **"Storage Quota Exceeded"** | Browser disk cache is full. | Modern browsers allocate up to several gigabytes for IndexedDB. Clear unnecessary browser site data or export a JSON backup and re-import. |
| **"Restore failed: missing data payload"** | Corrupt or non-MaintenX JSON file. | Ensure the file was generated via MaintenX's "Download Full JSON Backup" feature. |

---

*For technical inquiries or system configuration assistance, refer to the project documentation in README.md.*

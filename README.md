## Phone Backup Portal

**What it is:** a small Node/Express web app that lets you or your friends:

- Create an account on a hosted portal
- Get a personal **upload link** (URL)
- Open that link on a phone to upload photos/videos
- Log in on a desktop to **download individual files** or a **ZIP** per upload batch

No desktop helper app is required – downloads go through the browser’s normal “Save as…” flow.

### Configuration

Create a `.env` file in the project root:

```bash
MONGO_URL=mongodb+srv://USER:PASSWORD@HOST/DB_NAME
MONGO_DB_NAME=phonebackup
SESSION_SECRET=some-long-random-string
# Optional: override where uploaded files are stored
# STORAGE_ROOT=/absolute/path/to/uploads
# Optional: for generating upload links in settings
# BASE_URL=https://your-domain.example.com
```

By default, uploaded files are stored in an `uploads/` directory inside the project.

### Install and run (local with MongoDB)

```bash
cd phonebackup
npm install
npm run dev
```

Then open `http://localhost:3000` in your browser.

### Basic usage

1. **Sign up** on the home page.
2. After login, go to **Upload link** (Settings) to see your personal upload URL.
3. Open that URL on your phone (or share it with a friend).
4. On the phone, choose photos/videos and upload.
5. On your desktop, go to **Your uploads** to:
   - View upload batches
   - Download individual files
   - Download a full batch as a ZIP

### Deployment notes

- Deploy as a standard Node.js app on a managed platform (Render, Railway, Fly.io, etc.).
- Point `DATABASE_URL` at a managed Postgres instance.
- Use a persistent disk or volume for the `uploads/` directory, or adapt storage to a cloud bucket (S3, etc.) if needed.


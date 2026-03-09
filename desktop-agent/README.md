## Phone Backup Desktop Agent

This is a simple CLI-style desktop agent that connects to your Phone Backup portal
and automatically downloads new uploads into a folder on your computer.

### Requirements

- Node.js 18+ (for built-in `fetch`)

### First-time setup

1. Open a terminal on your desktop.
2. Go to the `desktop-agent` folder of this repo:

   ```bash
   cd desktop-agent
   ```

3. Run the agent:

   ```bash
   node index.js
   ```

4. Follow the prompts:

   - **Portal base URL** – e.g. `https://yourapp.example.com`
   - **Account email & password** – same as you use on the web portal
   - **Local folder** – where files should be saved (will be created if missing)

5. The agent will:

   - Request a sync token from the portal via `/api/sync/login`
   - Save its config at `~/.phonebackup-agent/config.json`
   - Start polling every ~30 seconds for new files

### Normal usage

After the first setup, next time you just run:

```bash
cd desktop-agent
node index.js
```

The agent will read the saved config and begin syncing:

- Calls `/api/sync/pending` to find new files for your account
- Downloads each one via `/api/sync/files/:id`
- Saves it into your chosen folder
- Marks them as synced with `/api/sync/mark-synced`

You can stop it any time with `Ctrl+C`.


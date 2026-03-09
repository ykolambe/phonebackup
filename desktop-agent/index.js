#!/usr/bin/env node

/**
 * Simple desktop sync agent for Phone Backup portal.
 * Requires Node.js 18+ (for global fetch).
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const readline = require("node:readline");

const CONFIG_DIR = path.join(os.homedir(), ".phonebackup-agent");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const POLL_INTERVAL_MS = 30000;

function question(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function loadConfig() {
  try {
    const raw = await fsp.readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveConfig(config) {
  await fsp.mkdir(CONFIG_DIR, { recursive: true });
  await fsp.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

async function ensureConfig() {
  const existing = await loadConfig();
  if (existing) {
    console.log("Using existing config at", CONFIG_PATH);
    return existing;
  }

  console.log("First-time setup for Phone Backup desktop agent.");
  console.log("You can edit the config later at:", CONFIG_PATH);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const baseUrlInput = await question(
      rl,
      "Portal base URL (e.g. https://yourapp.example.com): ",
    );
    const baseUrl = baseUrlInput.trim().replace(/\/+$/, "");

    const email = (await question(rl, "Account email: ")).trim();
    const password = (await question(rl, "Account password (visible): ")).trim();

    const folderInput = await question(
      rl,
      "Local folder to save files into (will be created if missing): ",
    );
    const syncFolder = path.resolve(folderInput.trim());

    await fsp.mkdir(syncFolder, { recursive: true });

    console.log("Requesting sync token from portal...");
    const loginRes = await fetch(`${baseUrl}/api/sync/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!loginRes.ok) {
      const text = await loginRes.text();
      throw new Error(
        `Failed to login for sync token (${loginRes.status}): ${text}`,
      );
    }

    const body = await loginRes.json();
    if (!body.token) {
      throw new Error("Sync login response missing token");
    }

    const config = {
      baseUrl,
      token: body.token,
      syncFolder,
    };
    await saveConfig(config);
    console.log("Config saved to", CONFIG_PATH);
    return config;
  } finally {
    rl.close();
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getUniquePath(dir, originalName) {
  let base = originalName;
  let ext = "";
  const dotIdx = originalName.lastIndexOf(".");
  if (dotIdx > 0 && dotIdx < originalName.length - 1) {
    base = originalName.slice(0, dotIdx);
    ext = originalName.slice(dotIdx);
  }

  let candidate = path.join(dir, originalName);
  let counter = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await fsp.access(candidate);
      candidate = path.join(dir, `${base} (${counter})${ext}`);
      counter += 1;
    } catch {
      return candidate;
    }
  }
}

async function syncLoop(config) {
  console.log("Starting sync loop. Press Ctrl+C to stop.");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const pendingRes = await fetch(`${config.baseUrl}/api/sync/pending`, {
        headers: {
          Authorization: `Bearer ${config.token}`,
        },
      });

      if (!pendingRes.ok) {
        const text = await pendingRes.text();
        console.error(
          "Error fetching pending files:",
          pendingRes.status,
          text,
        );
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const pending = await pendingRes.json();
      if (!Array.isArray(pending) || pending.length === 0) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      console.log(`Found ${pending.length} pending file(s). Downloading...`);

      const downloadedIds = [];

      // eslint-disable-next-line no-restricted-syntax
      for (const file of pending) {
        const destPath = await getUniquePath(
          config.syncFolder,
          file.originalName,
        );
        console.log(`Downloading ${file.originalName} -> ${destPath}`);

        const fileRes = await fetch(
          `${config.baseUrl}/api/sync/files/${file.id}`,
          {
            headers: { Authorization: `Bearer ${config.token}` },
          },
        );

        if (!fileRes.ok) {
          const text = await fileRes.text();
          console.error(
            "Failed to download file",
            file.id,
            fileRes.status,
            text,
          );
          // Skip marking this one as synced
          // eslint-disable-next-line no-continue
          continue;
        }

        const arrayBuffer = await fileRes.arrayBuffer();
        const buf = Buffer.from(arrayBuffer);
        await fsp.writeFile(destPath, buf);
        downloadedIds.push(file.id);
      }

      if (downloadedIds.length > 0) {
        const markRes = await fetch(
          `${config.baseUrl}/api/sync/mark-synced`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.token}`,
            },
            body: JSON.stringify({ fileIds: downloadedIds }),
          },
        );

        if (!markRes.ok) {
          const text = await markRes.text();
          console.error(
            "Failed to mark files as synced:",
            markRes.status,
            text,
          );
        } else {
          console.log("Marked files as synced:", downloadedIds.length);
        }
      }
    } catch (err) {
      console.error("Sync loop error:", err);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

async function main() {
  try {
    const config = await ensureConfig();
    await syncLoop(config);
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

main();


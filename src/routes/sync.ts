import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import { getDb, ObjectId } from "../db/mongo";

export const router = Router();

interface SyncTokenDoc {
  _id?: ObjectId;
  userId: ObjectId;
  token: string;
  createdAt: Date;
  lastUsedAt?: Date;
}

interface FileDoc {
  _id: ObjectId;
  userId: ObjectId;
  batchId: ObjectId;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  createdAt: Date;
  syncedAt?: Date | null;
  syncedBy?: ObjectId;
}

async function authenticateSyncToken(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authHeader = req.header("authorization") || req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return res.status(401).json({ error: "Invalid bearer token" });
  }

  const db = getDb();
  const tokens = db.collection<SyncTokenDoc>("sync_tokens");

  const doc = await tokens.findOne({ token });
  if (!doc) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  await tokens.updateOne(
    { _id: doc._id },
    { $set: { lastUsedAt: new Date() } },
  );

  (req as any).syncUserId = doc.userId.toHexString();
  return next();
}

router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body as {
    email?: string;
    password?: string;
  };

  if (!email || !password) {
    return res
      .status(400)
      .json({ error: "Email and password are required" });
  }

  try {
    const db = getDb();
    const users = db.collection<{
      _id: ObjectId;
      email: string;
      passwordHash: string;
    }>("users");
    const tokens = db.collection<SyncTokenDoc>("sync_tokens");

    const user = await users.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    await tokens.insertOne({
      userId: user._id,
      token,
      createdAt: new Date(),
    });

    return res.json({ token });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "Unexpected error" });
  }
});

router.get(
  "/pending",
  authenticateSyncToken,
  async (req: Request, res: Response) => {
    const userIdStr = (req as any).syncUserId as string;
    const userId = new ObjectId(userIdStr);

    const db = getDb();
    const filesCol = db.collection<FileDoc>("files");

    const pending = await filesCol
      .find({
        userId,
        $or: [{ syncedAt: { $exists: false } }, { syncedAt: null }],
      })
      .sort({ createdAt: 1 })
      .limit(100)
      .toArray();

    const items = pending.map((f) => ({
      id: f._id.toHexString(),
      batchId: f.batchId.toHexString(),
      originalName: f.originalName,
      sizeBytes: f.sizeBytes,
      createdAt: f.createdAt,
    }));

    return res.json(items);
  },
);

router.get(
  "/files/:id",
  authenticateSyncToken,
  async (req: Request, res: Response) => {
    const userIdStr = (req as any).syncUserId as string;
    const userId = new ObjectId(userIdStr);
    const fileIdStr = String(req.params.id);

    let fileId: ObjectId;
    try {
      fileId = new ObjectId(fileIdStr);
    } catch {
      return res.status(404).json({ error: "File not found" });
    }

    const db = getDb();
    const filesCol = db.collection<FileDoc>("files");

    const file = await filesCol.findOne({
      _id: fileId,
      userId,
    });

    if (!file) {
      return res.status(404).json({ error: "File not found" });
    }

    const filePath = path.resolve(file.storagePath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File missing on server" });
    }

    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", file.sizeBytes.toString());

    const stream = fs.createReadStream(filePath);
    stream.on("error", (err) => {
      // eslint-disable-next-line no-console
      console.error("Stream error", err);
      res.status(500).end();
    });
    stream.pipe(res);
  },
);

router.post(
  "/mark-synced",
  authenticateSyncToken,
  async (req: Request, res: Response) => {
    const userIdStr = (req as any).syncUserId as string;
    const userId = new ObjectId(userIdStr);
    const { fileIds } = req.body as { fileIds?: string[] };

    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: "fileIds array is required" });
    }

    const objectIds: ObjectId[] = [];
    for (const id of fileIds) {
      try {
        objectIds.push(new ObjectId(id));
      } catch {
        // skip invalid ids
      }
    }

    if (objectIds.length === 0) {
      return res.status(400).json({ error: "No valid file IDs provided" });
    }

    const db = getDb();
    const filesCol = db.collection<FileDoc>("files");

    const result = await filesCol.updateMany(
      {
        _id: { $in: objectIds },
        userId,
      },
      {
        $set: {
          syncedAt: new Date(),
          syncedBy: userId,
        },
      },
    );

    return res.json({ updatedCount: result.modifiedCount });
  },
);


import fs from "node:fs";
import path from "node:path";
import { Router, Request, Response } from "express";
import archiver from "archiver";
import { getDb, ObjectId } from "../db/mongo";
import { requireAuth } from "./auth";

export const router = Router();

router.get("/folders", requireAuth, async (req: Request, res: Response) => {
  const userIdStr = (req.session as any).userId as string;
  const userId = new ObjectId(userIdStr);

  const db = getDb();
  const foldersCol = db.collection<{
    _id?: ObjectId;
    userId: ObjectId;
    name: string;
    createdAt: Date;
  }>("folders");

  const filesCol = db.collection<{
    _id: ObjectId;
    userId: ObjectId;
    folderId: ObjectId;
    createdAt: Date;
    storagePath: string;
    originalName: string;
    sizeBytes: number;
  }>("files");

  const folders = await foldersCol
    .find({ userId })
    .sort({ createdAt: 1 })
    .toArray();

  const foldersWithCounts = await Promise.all(
    folders.map(async (folder) => {
      const count = await filesCol.countDocuments({
        userId,
        folderId: folder._id,
      });
      const agg = await filesCol
        .aggregate<{ _id: null; totalBytes: number }>([
          { $match: { userId, folderId: folder._id } },
          { $group: { _id: null, totalBytes: { $sum: "$sizeBytes" } } },
        ])
        .toArray();
      const totalBytes = agg[0]?.totalBytes || 0;
      return {
        id: folder._id.toHexString(),
        name: folder.name,
        created_at: folder.createdAt,
        file_count: count,
        total_bytes: totalBytes,
      };
    }),
  );

  return res.render("folders", { folders: foldersWithCounts });
});

router.post(
  "/folders/:id/clear",
  requireAuth,
  async (req: Request, res: Response) => {
    const userIdStr = (req.session as any).userId as string;
    const userId = new ObjectId(userIdStr);
    const folderIdStr = String(req.params.id);

    let folderId: ObjectId;
    try {
      folderId = new ObjectId(folderIdStr);
    } catch {
      return res.status(400).send("Invalid folder id");
    }

    const db = getDb();
    const filesCol = db.collection<{
      _id: ObjectId;
      userId: ObjectId;
      folderId: ObjectId;
      storagePath: string;
    }>("files");

    const files = await filesCol.find({ userId, folderId }).toArray();

    for (const file of files) {
      try {
        const filePath = path.resolve(file.storagePath);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // ignore individual delete errors
      }
    }

    await filesCol.deleteMany({ userId, folderId });

    return res.redirect("/folders");
  },
);

router.post(
  "/folders/:id/delete",
  requireAuth,
  async (req: Request, res: Response) => {
    const userIdStr = (req.session as any).userId as string;
    const userId = new ObjectId(userIdStr);
    const folderIdStr = String(req.params.id);

    let folderId: ObjectId;
    try {
      folderId = new ObjectId(folderIdStr);
    } catch {
      return res.status(400).send("Invalid folder id");
    }

    const db = getDb();
    const filesCol = db.collection<{
      _id: ObjectId;
      userId: ObjectId;
      folderId: ObjectId;
      storagePath: string;
    }>("files");
    const foldersCol = db.collection<{
      _id: ObjectId;
      userId: ObjectId;
      name: string;
      createdAt: Date;
    }>("folders");

    const files = await filesCol.find({ userId, folderId }).toArray();
    for (const file of files) {
      try {
        const filePath = path.resolve(file.storagePath);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // ignore individual delete errors
      }
    }

    await filesCol.deleteMany({ userId, folderId });
    await foldersCol.deleteOne({ _id: folderId, userId });

    return res.redirect("/folders");
  },
);

router.post("/folders", requireAuth, async (req: Request, res: Response) => {
  const userIdStr = (req.session as any).userId as string;
  const userId = new ObjectId(userIdStr);
  const { name } = req.body as { name?: string };

  if (!name || !name.trim()) {
    return res.status(400).send("Folder name is required");
  }

  const db = getDb();
  const foldersCol = db.collection<{
    _id?: ObjectId;
    userId: ObjectId;
    name: string;
    createdAt: Date;
  }>("folders");

  try {
    await foldersCol.insertOne({
      userId,
      name: name.trim(),
      createdAt: new Date(),
    });
  } catch (err: any) {
    if (err.code === 11000) {
      return res
        .status(400)
        .send("A folder with this name already exists for your account.");
    }
    // eslint-disable-next-line no-console
    console.error("Error creating folder", err);
    return res.status(500).send("Error creating folder");
  }

  return res.redirect("/folders");
});

router.get(
  "/folders/:id/download-all",
  requireAuth,
  async (req: Request, res: Response) => {
    const userIdStr = (req.session as any).userId as string;
    const userId = new ObjectId(userIdStr);
    const folderIdStr = String(req.params.id);

    let folderId: ObjectId;
    try {
      folderId = new ObjectId(folderIdStr);
    } catch {
      return res.status(404).send("Folder not found");
    }

    const db = getDb();
    const foldersCol = db.collection<{
      _id: ObjectId;
      userId: ObjectId;
      name: string;
      createdAt: Date;
    }>("folders");

    const filesCol = db.collection<{
      _id: ObjectId;
      userId: ObjectId;
      folderId: ObjectId;
      originalName: string;
      storagePath: string;
      sizeBytes: number;
    }>("files");

    const folder = await foldersCol.findOne({ _id: folderId, userId });
    if (!folder) {
      return res.status(404).send("Folder not found");
    }

    const files = await filesCol
      .find({
        userId,
        folderId,
      })
      .toArray();

    if (files.length === 0) {
      return res.status(404).send("No files available to download for this folder");
    }

    const safeName = folder.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="folder-${safeName || folderIdStr}.zip"`,
    );
    res.setHeader("Content-Type", "application/zip");

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err: Error) => {
      // eslint-disable-next-line no-console
      console.error("Archive error", err);
      res.status(500).end();
    });

    archive.pipe(res);

    for (const file of files) {
      const filePath = path.resolve(file.storagePath);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: file.originalName });
      }
    }

    const dbAfter = getDb();
    const filesColAfter = dbAfter.collection<{
      _id: ObjectId;
      userId: ObjectId;
      folderId: ObjectId;
      storagePath: string;
    }>("files");

    archive.finalize();
  },
);


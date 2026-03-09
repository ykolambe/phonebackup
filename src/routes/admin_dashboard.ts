import fs from "node:fs";
import path from "node:path";
import { Router, Request, Response, NextFunction } from "express";
import { getDb, ObjectId } from "../db/mongo";
import { requireAuth } from "./auth";

export const router = Router();

async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void | Response> {
  const userIdStr = (req.session as any).userId as string | undefined;
  if (!userIdStr) {
    return res.redirect("/login");
  }

  const adminEnv = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "";
  const adminEmails = adminEnv
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (adminEmails.length === 0) {
    return res.status(403).send("Admin is not configured on this server.");
  }

  const db = getDb();
  const usersCol = db.collection<{
    _id: ObjectId;
    email: string;
  }>("users");

  const user = await usersCol.findOne({ _id: new ObjectId(userIdStr) });
  if (!user || !adminEmails.includes(user.email.toLowerCase())) {
    return res.status(403).send("You are not allowed to access admin pages.");
  }

  (req as any).currentUser = user;
  return next();
}

router.get(
  "/admin",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    const db = getDb();
    const usersCol = db.collection("users");
    const filesCol = db.collection<{
      _id: ObjectId;
      userId: ObjectId;
      sizeBytes: number;
    }>("files");
    const plansCol = db.collection<{
      _id: ObjectId;
      name: string;
      maxBytes: number;
    }>("plans");

    const [userCount, fileAgg, users, plans] = await Promise.all([
      usersCol.countDocuments(),
      filesCol
        .aggregate<{
          _id: null;
          totalBytes: number;
          fileCount: number;
        }>([
          {
            $group: {
              _id: null,
              totalBytes: { $sum: "$sizeBytes" },
              fileCount: { $sum: 1 },
            },
          },
        ])
        .toArray(),
      usersCol.find().toArray(),
      plansCol.find().toArray(),
    ]);

    const usage = fileAgg[0] || { totalBytes: 0, fileCount: 0 };
    const totalUsedBytes = usage.totalBytes || 0;
    const totalFiles = usage.fileCount || 0;

    const defaultMaxBytesEnv = Number(process.env.DEFAULT_MAX_BYTES || "");
    const defaultMaxBytes =
      Number.isFinite(defaultMaxBytesEnv) && defaultMaxBytesEnv > 0
        ? defaultMaxBytesEnv
        : 2 * 1024 * 1024 * 1024;
    const defaultPlanName = process.env.DEFAULT_PLAN_NAME || "free";

    const plansByName = new Map<string, number>();
    for (const p of plans) {
      plansByName.set(p.name, p.maxBytes);
    }

    let totalAllocatedBytes = 0;
    for (const u of users as { planName?: string }[]) {
      const planName = u.planName || defaultPlanName;
      const max = plansByName.get(planName) ?? defaultMaxBytes;
      totalAllocatedBytes += max;
    }

    const storageRoot =
      process.env.STORAGE_ROOT || path.join(process.cwd(), "uploads");
    let diskUsedBytes = 0;
    try {
      const entries = fs.existsSync(storageRoot)
        ? fs.readdirSync(storageRoot, { withFileTypes: true })
        : [];
      for (const entry of entries) {
        if (entry.isFile()) {
          const fullPath = path.join(storageRoot, entry.name);
          const stat = fs.statSync(fullPath);
          diskUsedBytes += stat.size;
        }
      }
    } catch {
      // ignore disk errors; leave diskUsedBytes as 0
    }

    return res.render("admin_dashboard", {
      userCount,
      totalFiles,
      totalUsedBytes,
      totalAllocatedBytes,
      diskUsedBytes,
      storageRoot,
    });
  },
);


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
    planName?: string;
    createdAt?: Date;
  }>("users");

  const user = await usersCol.findOne({ _id: new ObjectId(userIdStr) });
  if (!user || !adminEmails.includes(user.email.toLowerCase())) {
    return res.status(403).send("You are not allowed to access admin pages.");
  }

  (req as any).currentUser = user;
  return next();
}

router.get(
  "/admin/users",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    const db = getDb();
    const usersCol = db.collection<{
      _id: ObjectId;
      email: string;
      planName?: string;
      createdAt?: Date;
      isVerified?: boolean;
      isDisabled?: boolean;
    }>("users");
    const filesCol = db.collection<{
      _id: ObjectId;
      userId: ObjectId;
      sizeBytes: number;
    }>("files");
    const plansCol = db.collection<{
      _id: ObjectId;
      name: string;
      maxBytes: number;
      createdAt?: Date;
    }>("plans");

    const [users, usageAgg, plans] = await Promise.all([
      usersCol
        .find()
        .sort({ createdAt: -1 })
        .toArray(),
      filesCol
        .aggregate<{
          _id: ObjectId;
          totalBytes: number;
          fileCount: number;
        }>([
          {
            $group: {
              _id: "$userId",
              totalBytes: { $sum: "$sizeBytes" },
              fileCount: { $sum: 1 },
            },
          },
        ])
        .toArray(),
      plansCol
        .find()
        .sort({ name: 1 })
        .toArray(),
    ]);

    const usageByUserId = new Map<
      string,
      { totalBytes: number; fileCount: number }
    >();
    for (const u of usageAgg) {
      usageByUserId.set(u._id.toHexString(), {
        totalBytes: u.totalBytes,
        fileCount: u.fileCount,
      });
    }

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

    const viewUsers = users.map((u) => {
      const idStr = u._id.toHexString();
      const usage = usageByUserId.get(idStr) || {
        totalBytes: 0,
        fileCount: 0,
      };
      const planName = u.planName || defaultPlanName;
      const planMax = plansByName.get(planName) ?? defaultMaxBytes;
      return {
        id: idStr,
        email: u.email,
        planName,
        created_at: u.createdAt,
        fileCount: usage.fileCount,
        totalBytes: usage.totalBytes,
        maxBytes: planMax,
        isVerified: !!u.isVerified,
        isDisabled: !!u.isDisabled,
      };
    });

    return res.render("admin_users", {
      users: viewUsers,
      plans,
      defaultMaxBytes,
      defaultPlanName,
    });
  },
);

router.get(
  "/admin/plans",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    const db = getDb();
    const plansCol = db.collection<{
      _id: ObjectId;
      name: string;
      maxBytes: number;
      createdAt?: Date;
    }>("plans");

    const plans = await plansCol
      .find()
      .sort({ name: 1 })
      .toArray();

    return res.render("admin_plans", { plans });
  },
);

router.post(
  "/admin/plans",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    const { name, maxGb } = req.body as { name?: string; maxGb?: string };

    const nameTrimmed = (name || "").trim();
    if (!nameTrimmed) {
      return res.status(400).send("Plan name is required");
    }

    const gb = parseFloat(maxGb || "");
    if (!Number.isFinite(gb) || gb <= 0) {
      return res.status(400).send("maxGb must be a positive number");
    }

    const maxBytes = gb * 1024 * 1024 * 1024;

    const db = getDb();
    const plansCol = db.collection<{
      _id?: ObjectId;
      name: string;
      maxBytes: number;
      createdAt?: Date;
    }>("plans");

    await plansCol.updateOne(
      { name: nameTrimmed },
      {
        $set: {
          name: nameTrimmed,
          maxBytes,
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );

    return res.redirect("/admin/plans");
  },
);

router.post(
  "/admin/users/:id/plan",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    const userIdStr = String(req.params.id);
    const { planName } = req.body as { planName?: string | string[] };

    const planNameStr: string =
      typeof planName === "string"
        ? planName
        : Array.isArray(planName)
        ? planName[0]
        : "";

    if (!planNameStr || !planNameStr.trim()) {
      return res.status(400).send("planName is required");
    }

    let userId: ObjectId;
    try {
      userId = new ObjectId(userIdStr);
    } catch {
      return res.status(400).send("Invalid user id");
    }

    const db = getDb();
    const usersCol = db.collection("users");
    const plansCol = db.collection<{
      _id?: ObjectId;
      name: string;
      maxBytes: number;
    }>("plans");

    const plan = await plansCol.findOne({ name: planNameStr as string });
    if (!plan) {
      return res
        .status(400)
        .send("Plan does not exist. Create it in the database first.");
    }

    await usersCol.updateOne(
      { _id: userId },
      { $set: { planName: planNameStr.trim() } },
    );

    return res.redirect("/admin/users");
  },
);

router.post(
  "/admin/users",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    const { email, password, planName } = req.body as {
      email?: string;
      password?: string;
      planName?: string | string[];
    };

    const emailTrimmed = (email || "").trim().toLowerCase();
    const passwordStr = (password || "").trim();
    const planNameStr =
      typeof planName === "string"
        ? planName
        : Array.isArray(planName)
        ? planName[0]
        : "";

    if (!emailTrimmed || !passwordStr) {
      return res.status(400).send("email and password are required");
    }

    const db = getDb();
    const usersCol = db.collection("users");
    const plansCol = db.collection<{
      _id?: ObjectId;
      name: string;
      maxBytes: number;
    }>("plans");

    const existing = await usersCol.findOne({ email: emailTrimmed });
    if (existing) {
      return res.status(400).send("User with this email already exists");
    }

    const planNameFinal = planNameStr || process.env.DEFAULT_PLAN_NAME || "free";
    const plan = await plansCol.findOne({ name: planNameFinal });
    if (!plan) {
      return res
        .status(400)
        .send("Plan does not exist. Create it in the Plans tab first.");
    }

    const hash = await (await import("bcrypt")).default.hash(passwordStr, 10);

    await usersCol.insertOne({
      email: emailTrimmed,
      passwordHash: hash,
      createdAt: new Date(),
      planName: planNameFinal,
      isVerified: true,
      isDisabled: false,
    });

    return res.redirect("/admin/users");
  },
);

router.post(
  "/admin/users/:id/disable",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    const userIdStr = String(req.params.id);
    let userId: ObjectId;
    try {
      userId = new ObjectId(userIdStr);
    } catch {
      return res.status(400).send("Invalid user id");
    }

    const db = getDb();
    const usersCol = db.collection("users");
    await usersCol.updateOne({ _id: userId }, { $set: { isDisabled: true } });

    return res.redirect("/admin/users");
  },
);

router.post(
  "/admin/users/:id/enable",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    const userIdStr = String(req.params.id);
    let userId: ObjectId;
    try {
      userId = new ObjectId(userIdStr);
    } catch {
      return res.status(400).send("Invalid user id");
    }

    const db = getDb();
    const usersCol = db.collection("users");
    await usersCol.updateOne({ _id: userId }, { $set: { isDisabled: false } });

    return res.redirect("/admin/users");
  },
);

router.post(
  "/admin/users/:id/delete",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    const userIdStr = String(req.params.id);
    let userId: ObjectId;
    try {
      userId = new ObjectId(userIdStr);
    } catch {
      return res.status(400).send("Invalid user id");
    }

    const db = getDb();
    const usersCol = db.collection("users");
    const filesCol = db.collection<{
      _id: ObjectId;
      userId: ObjectId;
      storagePath: string;
    }>("files");
    const batchesCol = db.collection("upload_batches");
    const linksCol = db.collection("upload_links");
    const foldersCol = db.collection("folders");

    const files = await filesCol.find({ userId }).toArray();
    for (const file of files) {
      try {
        const filePath = require("node:path").resolve(file.storagePath);
        const fs = require("node:fs");
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // ignore individual delete errors
      }
    }

    await Promise.all([
      filesCol.deleteMany({ userId }),
      batchesCol.deleteMany({ userId }),
      linksCol.deleteMany({ userId }),
      foldersCol.deleteMany({ userId }),
    ]);

    await usersCol.deleteOne({ _id: userId });

    return res.redirect("/admin/users");
  },
);


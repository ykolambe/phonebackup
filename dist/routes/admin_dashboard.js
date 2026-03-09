"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const express_1 = require("express");
const mongo_1 = require("../db/mongo");
const auth_1 = require("./auth");
exports.router = (0, express_1.Router)();
async function requireAdmin(req, res, next) {
    const userIdStr = req.session.userId;
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
    const db = (0, mongo_1.getDb)();
    const usersCol = db.collection("users");
    const user = await usersCol.findOne({ _id: new mongo_1.ObjectId(userIdStr) });
    if (!user || !adminEmails.includes(user.email.toLowerCase())) {
        return res.status(403).send("You are not allowed to access admin pages.");
    }
    req.currentUser = user;
    return next();
}
exports.router.get("/admin", auth_1.requireAuth, requireAdmin, async (req, res) => {
    const db = (0, mongo_1.getDb)();
    const usersCol = db.collection("users");
    const filesCol = db.collection("files");
    const plansCol = db.collection("plans");
    const [userCount, fileAgg, users, plans] = await Promise.all([
        usersCol.countDocuments(),
        filesCol
            .aggregate([
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
    const defaultMaxBytes = Number.isFinite(defaultMaxBytesEnv) && defaultMaxBytesEnv > 0
        ? defaultMaxBytesEnv
        : 2 * 1024 * 1024 * 1024;
    const defaultPlanName = process.env.DEFAULT_PLAN_NAME || "free";
    const plansByName = new Map();
    for (const p of plans) {
        plansByName.set(p.name, p.maxBytes);
    }
    let totalAllocatedBytes = 0;
    for (const u of users) {
        const planName = u.planName || defaultPlanName;
        const max = plansByName.get(planName) ?? defaultMaxBytes;
        totalAllocatedBytes += max;
    }
    const storageRoot = process.env.STORAGE_ROOT || node_path_1.default.join(process.cwd(), "uploads");
    let diskUsedBytes = 0;
    try {
        const entries = node_fs_1.default.existsSync(storageRoot)
            ? node_fs_1.default.readdirSync(storageRoot, { withFileTypes: true })
            : [];
        for (const entry of entries) {
            if (entry.isFile()) {
                const fullPath = node_path_1.default.join(storageRoot, entry.name);
                const stat = node_fs_1.default.statSync(fullPath);
                diskUsedBytes += stat.size;
            }
        }
    }
    catch {
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
});

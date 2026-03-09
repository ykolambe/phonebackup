"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const mongo_1 = require("../db/mongo");
const auth_1 = require("./auth");
const userCleanup_1 = require("../db/userCleanup");
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
exports.router.get("/admin/users", auth_1.requireAuth, requireAdmin, async (req, res) => {
    const db = (0, mongo_1.getDb)();
    const usersCol = db.collection("users");
    const filesCol = db.collection("files");
    const plansCol = db.collection("plans");
    const [users, usageAgg, plans] = await Promise.all([
        usersCol
            .find()
            .sort({ createdAt: -1 })
            .toArray(),
        filesCol
            .aggregate([
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
    const usageByUserId = new Map();
    for (const u of usageAgg) {
        usageByUserId.set(u._id.toHexString(), {
            totalBytes: u.totalBytes,
            fileCount: u.fileCount,
        });
    }
    const defaultMaxBytesEnv = Number(process.env.DEFAULT_MAX_BYTES || "");
    const defaultMaxBytes = Number.isFinite(defaultMaxBytesEnv) && defaultMaxBytesEnv > 0
        ? defaultMaxBytesEnv
        : 2 * 1024 * 1024 * 1024;
    const defaultPlanName = process.env.DEFAULT_PLAN_NAME || "free";
    const plansByName = new Map();
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
});
exports.router.get("/admin/plans", auth_1.requireAuth, requireAdmin, async (req, res) => {
    const db = (0, mongo_1.getDb)();
    const plansCol = db.collection("plans");
    const plans = await plansCol
        .find()
        .sort({ name: 1 })
        .toArray();
    return res.render("admin_plans", { plans });
});
exports.router.post("/admin/plans", auth_1.requireAuth, requireAdmin, async (req, res) => {
    const { name, maxGb } = req.body;
    const nameTrimmed = (name || "").trim();
    if (!nameTrimmed) {
        return res.status(400).send("Plan name is required");
    }
    const gb = parseFloat(maxGb || "");
    if (!Number.isFinite(gb) || gb <= 0) {
        return res.status(400).send("maxGb must be a positive number");
    }
    const maxBytes = gb * 1024 * 1024 * 1024;
    const db = (0, mongo_1.getDb)();
    const plansCol = db.collection("plans");
    await plansCol.updateOne({ name: nameTrimmed }, {
        $set: {
            name: nameTrimmed,
            maxBytes,
        },
        $setOnInsert: {
            createdAt: new Date(),
        },
    }, { upsert: true });
    return res.redirect("/admin/plans");
});
exports.router.post("/admin/users/:id/plan", auth_1.requireAuth, requireAdmin, async (req, res) => {
    const userIdStr = String(req.params.id);
    const { planName } = req.body;
    const planNameStr = typeof planName === "string"
        ? planName
        : Array.isArray(planName)
            ? planName[0]
            : "";
    if (!planNameStr || !planNameStr.trim()) {
        return res.status(400).send("planName is required");
    }
    let userId;
    try {
        userId = new mongo_1.ObjectId(userIdStr);
    }
    catch {
        return res.status(400).send("Invalid user id");
    }
    const db = (0, mongo_1.getDb)();
    const usersCol = db.collection("users");
    const plansCol = db.collection("plans");
    const plan = await plansCol.findOne({ name: planNameStr });
    if (!plan) {
        return res
            .status(400)
            .send("Plan does not exist. Create it in the database first.");
    }
    await usersCol.updateOne({ _id: userId }, { $set: { planName: planNameStr.trim() } });
    return res.redirect("/admin/users");
});
exports.router.post("/admin/users", auth_1.requireAuth, requireAdmin, async (req, res) => {
    const { email, password, planName } = req.body;
    const emailTrimmed = (email || "").trim().toLowerCase();
    const passwordStr = (password || "").trim();
    const planNameStr = typeof planName === "string"
        ? planName
        : Array.isArray(planName)
            ? planName[0]
            : "";
    if (!emailTrimmed || !passwordStr) {
        return res.status(400).send("email and password are required");
    }
    const db = (0, mongo_1.getDb)();
    const usersCol = db.collection("users");
    const plansCol = db.collection("plans");
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
    const hash = await (await Promise.resolve().then(() => __importStar(require("bcrypt")))).default.hash(passwordStr, 10);
    await usersCol.insertOne({
        email: emailTrimmed,
        passwordHash: hash,
        createdAt: new Date(),
        planName: planNameFinal,
        isVerified: true,
        isDisabled: false,
    });
    return res.redirect("/admin/users");
});
exports.router.post("/admin/users/:id/disable", auth_1.requireAuth, requireAdmin, async (req, res) => {
    const userIdStr = String(req.params.id);
    let userId;
    try {
        userId = new mongo_1.ObjectId(userIdStr);
    }
    catch {
        return res.status(400).send("Invalid user id");
    }
    const db = (0, mongo_1.getDb)();
    const usersCol = db.collection("users");
    await usersCol.updateOne({ _id: userId }, { $set: { isDisabled: true } });
    return res.redirect("/admin/users");
});
exports.router.post("/admin/users/:id/enable", auth_1.requireAuth, requireAdmin, async (req, res) => {
    const userIdStr = String(req.params.id);
    let userId;
    try {
        userId = new mongo_1.ObjectId(userIdStr);
    }
    catch {
        return res.status(400).send("Invalid user id");
    }
    const db = (0, mongo_1.getDb)();
    const usersCol = db.collection("users");
    await usersCol.updateOne({ _id: userId }, { $set: { isDisabled: false } });
    return res.redirect("/admin/users");
});
exports.router.post("/admin/users/:id/delete", auth_1.requireAuth, requireAdmin, async (req, res) => {
    const userIdStr = String(req.params.id);
    let userId;
    try {
        userId = new mongo_1.ObjectId(userIdStr);
    }
    catch {
        return res.status(400).send("Invalid user id");
    }
    await (0, userCleanup_1.deleteUserData)(userId, { deleteUser: true });
    return res.redirect("/admin/users");
});
exports.router.post("/admin/users/:id/clear-data", auth_1.requireAuth, requireAdmin, async (req, res) => {
    const userIdStr = String(req.params.id);
    let userId;
    try {
        userId = new mongo_1.ObjectId(userIdStr);
    }
    catch {
        return res.status(400).send("Invalid user id");
    }
    await (0, userCleanup_1.deleteUserData)(userId, { deleteUser: false });
    return res.redirect("/admin/users");
});

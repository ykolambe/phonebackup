"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
exports.requireAuth = requireAuth;
const express_1 = require("express");
const bcrypt_1 = __importDefault(require("bcrypt"));
const mongo_1 = require("../db/mongo");
exports.router = (0, express_1.Router)();
exports.router.post("/signup", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).render("signup", { error: "Email and password are required" });
    }
    try {
        const db = (0, mongo_1.getDb)();
        const users = db.collection("users");
        const existing = await users.findOne({
            email: email.toLowerCase(),
        });
        if (existing) {
            return res
                .status(400)
                .render("signup", { error: "Email already registered" });
        }
        const hash = await bcrypt_1.default.hash(password, 10);
        const defaultPlanName = process.env.DEFAULT_PLAN_NAME || "free";
        await users.insertOne({
            email: email.toLowerCase(),
            passwordHash: hash,
            createdAt: new Date(),
            planName: defaultPlanName,
            isVerified: true,
            isDisabled: true,
        });
        // Do not log the user in yet; require admin approval first.
        return res
            .status(200)
            .render("login", {
            error: "Account created. An administrator must enable your account before you can log in.",
        });
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        res.status(500).render("signup", { error: "Unexpected error, please try again" });
    }
});
exports.router.post("/login", async (req, res) => {
    const { email, password, next } = req.body;
    if (!email || !password) {
        return res.status(400).render("login", { error: "Email and password are required" });
    }
    try {
        const db = (0, mongo_1.getDb)();
        const users = db.collection("users");
        const user = await users.findOne({ email: email.toLowerCase() });
        if (!user) {
            return res.status(400).render("login", { error: "Invalid email or password" });
        }
        const ok = await bcrypt_1.default.compare(password, user.passwordHash);
        if (!ok) {
            return res.status(400).render("login", { error: "Invalid email or password" });
        }
        if (user.isDisabled) {
            return res
                .status(403)
                .render("login", { error: "This account has been disabled by an administrator." });
        }
        req.session.userId = user._id.toString();
        let redirectTo = "/batches";
        if (typeof next === "string" && next.startsWith("/") && !next.includes("://")) {
            redirectTo = next;
        }
        res.redirect(redirectTo);
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        res.status(500).render("login", { error: "Unexpected error, please try again" });
    }
});
exports.router.post("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/login");
    });
});
function requireAuth(req, res, next) {
    if (req.session?.userId) {
        return next();
    }
    return res.redirect("/login");
}

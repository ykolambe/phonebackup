"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const express_1 = __importDefault(require("express"));
const express_session_1 = __importDefault(require("express-session"));
const dotenv_1 = __importDefault(require("dotenv"));
const auth_1 = require("./routes/auth");
const uploads_1 = require("./routes/uploads");
const downloads_1 = require("./routes/downloads");
const sync_1 = require("./routes/sync");
const folders_1 = require("./routes/folders");
const admin_1 = require("./routes/admin");
const admin_dashboard_1 = require("./routes/admin_dashboard");
const account_1 = require("./routes/account");
const schema_1 = require("./db/schema");
const cleanup_1 = require("./db/cleanup");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET env var is required");
}
const ROOT_DIR = node_path_1.default.join(__dirname, "..");
app.set("view engine", "ejs");
app.set("views", node_path_1.default.join(ROOT_DIR, "views"));
app.use(express_1.default.urlencoded({ extended: true }));
app.use(express_1.default.json());
app.use((0, express_session_1.default)({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
    },
}));
app.use(express_1.default.static(node_path_1.default.join(ROOT_DIR, "public")));
app.use("/api/auth", auth_1.router);
app.use("/api/sync", sync_1.router);
app.use("/", admin_dashboard_1.router);
app.use("/", admin_1.router);
app.use("/", folders_1.router);
app.use("/", account_1.router);
app.use("/", uploads_1.router);
app.use("/", downloads_1.router);
app.get("/", (req, res) => {
    if (req.session.userId) {
        res.redirect("/batches");
    }
    else {
        res.render("index");
    }
});
app.get("/login", (req, res) => {
    const next = typeof req.query.next === "string" ? req.query.next : "";
    res.render("login", { next });
});
app.get("/signup", (req, res) => {
    res.render("signup");
});
async function start() {
    await (0, schema_1.initDb)();
    (0, cleanup_1.scheduleExpiredFilesCleanup)();
    app.listen(PORT, () => {
        // eslint-disable-next-line no-console
        console.log(`Server listening on port ${PORT}`);
    });
}
start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to start server", err);
    process.exit(1);
});

import path from "node:path";
import express from "express";
import session from "express-session";
import dotenv from "dotenv";

import { router as authRouter } from "./routes/auth";
import { router as uploadsRouter } from "./routes/uploads";
import { router as downloadsRouter } from "./routes/downloads";
import { router as syncRouter } from "./routes/sync";
import { router as foldersRouter } from "./routes/folders";
import { router as adminRouter } from "./routes/admin";
import { router as adminDashboardRouter } from "./routes/admin_dashboard";
import { router as accountRouter } from "./routes/account";
import { initDb } from "./db/schema";
import { scheduleExpiredFilesCleanup } from "./db/cleanup";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET env var is required");
}

const ROOT_DIR = path.join(__dirname, "..");

app.set("view engine", "ejs");
app.set("views", path.join(ROOT_DIR, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
    },
  })
);

app.use(express.static(path.join(ROOT_DIR, "public")));

app.use("/api/auth", authRouter);
app.use("/api/sync", syncRouter);
app.use("/", adminDashboardRouter);
app.use("/", adminRouter);
app.use("/", foldersRouter);
app.use("/", accountRouter);
app.use("/", uploadsRouter);
app.use("/", downloadsRouter);

app.get("/", (req, res) => {
  if ((req.session as any).userId) {
    res.redirect("/batches");
  } else {
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
  await initDb();
  scheduleExpiredFilesCleanup();
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


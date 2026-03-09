import { Router } from "express";
import bcrypt from "bcrypt";
import { getDb } from "../db/mongo";

export const router = Router();

router.post("/signup", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    return res.status(400).render("signup", { error: "Email and password are required" });
  }

  try {
    const db = getDb();
    const users = db.collection("users");

    const existing = await users.findOne<{ _id: unknown }>({
      email: email.toLowerCase(),
    });
    if (existing) {
      return res
        .status(400)
        .render("signup", { error: "Email already registered" });
    }

    const hash = await bcrypt.hash(password, 10);
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
        error:
          "Account created. An administrator must enable your account before you can log in.",
      });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).render("signup", { error: "Unexpected error, please try again" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password, next } = req.body as {
    email?: string;
    password?: string;
    next?: string;
  };

  if (!email || !password) {
    return res.status(400).render("login", { error: "Email and password are required" });
  }

  try {
    const db = getDb();
    const users = db.collection<{
      _id: unknown;
      email: string;
      passwordHash: string;
      planName?: string;
      isVerified?: boolean;
      isDisabled?: boolean;
    }>("users");

    const user = await users.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(400).render("login", { error: "Invalid email or password" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);

    if (!ok) {
      return res.status(400).render("login", { error: "Invalid email or password" });
    }

    if (user.isDisabled) {
      return res
        .status(403)
        .render("login", { error: "This account has been disabled by an administrator." });
    }

    (req.session as any).userId = (user._id as any).toString();

    let redirectTo = "/batches";
    if (typeof next === "string" && next.startsWith("/") && !next.includes("://")) {
      redirectTo = next;
    }

    res.redirect(redirectTo);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).render("login", { error: "Unexpected error, please try again" });
  }
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

export function requireAuth(
  req: Parameters<Router["use"]>[0],
  res: any,
  next: any,
): void | any {
  if ((req as any).session?.userId) {
    return (next as any)();
  }
  return res.redirect("/login");
}


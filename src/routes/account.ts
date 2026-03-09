import { Router, Request, Response } from "express";
import { ObjectId } from "../db/mongo";
import { requireAuth } from "./auth";
import { deleteUserData } from "../db/userCleanup";

export const router = Router();

router.post(
  "/account/delete",
  requireAuth,
  async (req: Request, res: Response) => {
    const userIdStr = (req.session as any).userId as string | undefined;
    if (!userIdStr) {
      return res.redirect("/login");
    }

    let userId: ObjectId;
    try {
      userId = new ObjectId(userIdStr);
    } catch {
      return res.status(400).send("Invalid user id");
    }

    await deleteUserData(userId, { deleteUser: true });

    req.session.destroy(() => {
      res.redirect("/");
    });
  },
);


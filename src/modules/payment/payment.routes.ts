import { Router } from "express";
import { PaymentController } from "./payment.controller";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware";

const router = Router();
const paymentController = new PaymentController();

router.use(requireAuth);

router.get(
  "/transactions",
  requireRole(["USER"]),
  paymentController.getTransactions.bind(paymentController),
);
router.get(
  "/transactions/:id",
  requireRole(["USER"]),
  paymentController.getTransactionDetails.bind(paymentController),
);
router.post(
  "/initiate",
  requireRole(["USER"]),
  paymentController.initiate.bind(paymentController),
);
router.post(
  "/verify",
  requireRole(["USER"]),
  paymentController.verify.bind(paymentController),
);
router.post(
  "/:id/verify",
  requireRole(["USER"]),
  paymentController.verify.bind(paymentController),
);
router.post(
  "/:id/refund",
  requireRole(["ADMIN", "SUPER_ADMIN"]),
  paymentController.refund.bind(paymentController),
);

export default router;

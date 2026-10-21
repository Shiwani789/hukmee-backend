import { Router } from "express";
import { NotificationController } from "./notification.controller";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware";
import { validateRequest } from "../../middlewares/validate.middleware";
import { updateNotificationPreferencesSchema } from "../../validation/notification";

const router = Router();
const notificationController = new NotificationController();

router.use(requireAuth);

router.get(
  "/preferences",
  notificationController.getPreferences.bind(notificationController),
);
router.patch(
  "/preferences",
  validateRequest(updateNotificationPreferencesSchema),
  notificationController.updatePreferences.bind(notificationController),
);
router.get(
  "/",
  notificationController.getMyNotifications.bind(notificationController),
);
router.get(
  "/unread-count",
  notificationController.getUnreadCount.bind(notificationController),
);
router.post(
  "/admin/send",
  requireRole(["ADMIN", "SUPER_ADMIN"]),
  notificationController.sendToUser.bind(notificationController),
);
router.post(
  "/admin/users/:userId/send",
  requireRole(["ADMIN", "SUPER_ADMIN"]),
  notificationController.sendToUser.bind(notificationController),
);
router.post(
  "/admin/broadcast",
  requireRole(["ADMIN", "SUPER_ADMIN"]),
  notificationController.sendToAll.bind(notificationController),
);
router.post(
  "/device-token",
  notificationController.registerDeviceToken.bind(notificationController),
);
router.delete(
  "/device-token",
  notificationController.removeDeviceToken.bind(notificationController),
);
router.patch(
  "/read-all",
  notificationController.markAllAsRead.bind(notificationController),
);
router.put(
  "/mark-all-read",
  notificationController.markAllAsRead.bind(notificationController),
);
router.patch(
  "/:id/read",
  notificationController.markAsRead.bind(notificationController),
);
router.put(
  "/:id/read",
  notificationController.markAsRead.bind(notificationController),
);
router.delete(
  "/:id",
  notificationController.deleteNotification.bind(notificationController),
);

export default router;

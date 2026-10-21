import { Request, Response } from "express";
import { NotificationService } from "./notification.service";

const notificationService = new NotificationService();

export class NotificationController {
  async getPreferences(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      const preferences =
        await notificationService.getOrCreatePreferences(userId);
      res.status(200).json({ success: true, data: preferences });
    } catch (error: any) {
      res
        .status(error.statusCode || 500)
        .json({ success: false, message: error.message });
    }
  }

  async updatePreferences(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      const preferences = await notificationService.updatePreferences(
        userId,
        req.body,
      );
      res.status(200).json({
        success: true,
        message: "Notification preferences updated successfully.",
        data: preferences,
      });
    } catch (error: any) {
      res
        .status(error.statusCode || 500)
        .json({ success: false, message: error.message });
    }
  }

  async getMyNotifications(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      const notifications = await notificationService.getUserNotifications(
        userId,
        req.query,
      );
      res.status(200).json({ success: true, data: notifications });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getUnreadCount(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      const data = await notificationService.getUnreadCount(userId);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async markAsRead(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      const notification = await notificationService.markAsRead(
        String(req.params.id),
        userId,
      );
      res.status(200).json({
        success: true,
        message: "Notification marked as read",
        data: notification,
      });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async markAllAsRead(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      await notificationService.markAllAsRead(userId);
      res
        .status(200)
        .json({ success: true, message: "All notifications marked as read" });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async deleteNotification(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      await notificationService.deleteNotification(
        String(req.params.id),
        userId,
      );
      res
        .status(200)
        .json({ success: true, message: "Notification deleted successfully" });
    } catch (error: any) {
      res
        .status(error.statusCode || 400)
        .json({ success: false, message: error.message });
    }
  }

  async registerDeviceToken(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      const token = await notificationService.registerDeviceToken(
        userId,
        req.body,
      );
      res.status(200).json({
        success: true,
        message: "Device token registered",
        data: token,
      });
    } catch (error: any) {
      res
        .status(error.statusCode || 400)
        .json({ success: false, message: error.message });
    }
  }

  async removeDeviceToken(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      await notificationService.removeDeviceToken(
        userId,
        String(req.body?.token || ""),
      );
      res.status(200).json({ success: true, message: "Device token removed" });
    } catch (error: any) {
      res
        .status(error.statusCode || 400)
        .json({ success: false, message: error.message });
    }
  }

  async sendToUser(req: Request, res: Response) {
    try {
      const userId = req.body?.userId || req.params.userId;
      const notification =
        await notificationService.sendAdminNotificationToUser({
          ...req.body,
          userId,
        });
      res.status(201).json({
        success: true,
        message: "Notification sent successfully",
        data: notification,
      });
    } catch (error: any) {
      res
        .status(error.statusCode || 400)
        .json({ success: false, message: error.message });
    }
  }

  async sendToAll(req: Request, res: Response) {
    try {
      const result = await notificationService.sendAdminNotificationToAll(
        req.body,
      );
      res.status(201).json({
        success: true,
        message: "Notification broadcast sent successfully",
        data: result,
      });
    } catch (error: any) {
      res
        .status(error.statusCode || 400)
        .json({ success: false, message: error.message });
    }
  }
}

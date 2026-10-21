import { NotificationType, UserRole } from "@prisma/client";
import { prisma } from "../../config/database";
import { firebaseMessaging } from "../../config/firebase";
import { logger } from "../../config/logger";
import { BadRequestError, NotFoundError } from "../../utils/errors";

export interface CreateNotificationDto {
  userId: string;
  type: NotificationType | string;
  title: string;
  message: string;
  referenceId?: string | null;
  referenceType?: string | null;
  eventKey?: string | null;
  data?: any;
  category?: "TRANSACTIONAL" | "PROMOTIONAL";
}

export interface NotificationPreferenceDto {
  pushEnabled: boolean;
  smsEnabled: boolean;
  emailEnabled: boolean;
  promotionsEnabled: boolean;
}

export interface RegisterDeviceTokenDto {
  token: string;
  deviceType?: string;
  deviceName?: string;
}

export interface AdminNotificationDto {
  title: string;
  message: string;
  userId?: string;
  type?: NotificationType | string;
  referenceId?: string | null;
  referenceType?: string | null;
  data?: any;
}

export class NotificationService {
  private readonly invalidTokenCodes = new Set([
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered",
    "messaging/invalid-argument",
  ]);

  private normalizeType(type: NotificationType | string): NotificationType {
    const normalized = String(type || "SYSTEM").toUpperCase();
    if (
      Object.values(NotificationType).includes(normalized as NotificationType)
    ) {
      return normalized as NotificationType;
    }
    return NotificationType.SYSTEM;
  }

  private buildEventKey(data: CreateNotificationDto): string {
    if (data.eventKey) return data.eventKey;
    const type = this.normalizeType(data.type);
    const referenceType = data.referenceType || "GENERAL";
    const referenceId = data.referenceId || "NONE";
    return `${type}:${referenceType}:${referenceId}`;
  }

  private toFcmData(notification: any): Record<string, string> {
    const data =
      notification.data && typeof notification.data === "object"
        ? notification.data
        : {};
    return Object.entries({
      ...data,
      notificationId: notification.id,
      type: notification.type,
      referenceId: notification.referenceId || "",
      referenceType: notification.referenceType || "",
    }).reduce(
      (acc, [key, value]) => {
        acc[key] = value === null || value === undefined ? "" : String(value);
        return acc;
      },
      {} as Record<string, string>,
    );
  }

  private serializePreference(preference: any): NotificationPreferenceDto {
    return {
      pushEnabled: preference.pushEnabled,
      smsEnabled: preference.smsEnabled,
      emailEnabled: preference.emailEnabled,
      promotionsEnabled: preference.promotionsEnabled,
    };
  }

  async getOrCreatePreferences(
    userId: string,
  ): Promise<NotificationPreferenceDto> {
    const preference = await prisma.notificationPreference.upsert({
      where: { userId },
      update: {},
      create: { userId },
      select: {
        pushEnabled: true,
        smsEnabled: true,
        emailEnabled: true,
        promotionsEnabled: true,
      },
    });

    return this.serializePreference(preference);
  }

  async updatePreferences(
    userId: string,
    data: NotificationPreferenceDto,
  ): Promise<NotificationPreferenceDto> {
    const preference = await prisma.notificationPreference.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
      select: {
        pushEnabled: true,
        smsEnabled: true,
        emailEnabled: true,
        promotionsEnabled: true,
      },
    });

    return this.serializePreference(preference);
  }

  async canSendNotification(
    userId: string,
    channel: "push" | "sms" | "email",
    category: "TRANSACTIONAL" | "PROMOTIONAL" = "TRANSACTIONAL",
  ): Promise<boolean> {
    const preferences = await this.getOrCreatePreferences(userId);

    if (category === "PROMOTIONAL" && !preferences.promotionsEnabled) {
      return false;
    }

    if (channel === "push") return preferences.pushEnabled;
    if (channel === "sms") return preferences.smsEnabled;
    return preferences.emailEnabled;
  }

  async createNotification(data: CreateNotificationDto) {
    const type = this.normalizeType(data.type);
    const eventKey = this.buildEventKey({ ...data, type });

    try {
      return await prisma.notification.upsert({
        where: {
          userId_eventKey: {
            userId: data.userId,
            eventKey,
          },
        },
        update: {},
        create: {
          userId: data.userId,
          type,
          title: data.title,
          message: data.message,
          referenceId: data.referenceId || null,
          referenceType: data.referenceType || null,
          eventKey,
          data: data.data || {},
        },
      });
    } catch (error) {
      logger.error(
        { err: error, userId: data.userId, type, eventKey },
        "Notification creation failed",
      );
      throw error;
    }
  }

  async createBulkNotifications(notifications: CreateNotificationDto[]) {
    const results = [];
    for (const notification of notifications) {
      results.push(await this.createNotification(notification));
    }
    return results;
  }

  async sendPushNotification(userId: string, notification: any) {
    const category =
      notification?.category === "PROMOTIONAL" ||
      notification?.data?.category === "PROMOTIONAL"
        ? "PROMOTIONAL"
        : "TRANSACTIONAL";
    const isAllowed = await this.canSendNotification(userId, "push", category);
    if (!isAllowed)
      return {
        sent: 0,
        failed: 0,
        skipped: true,
        reason: "PUSH_NOT_ALLOWED_BY_PREFERENCE",
      };

    const messaging = firebaseMessaging;
    if (!messaging) return { sent: 0, failed: 0, skipped: true };

    const tokens = await prisma.userDeviceToken.findMany({
      where: { userId, isActive: true },
      select: { token: true },
    });

    if (tokens.length === 0) return { sent: 0, failed: 0 };

    let sent = 0;
    let failed = 0;
    const invalidTokens: string[] = [];

    await Promise.all(
      tokens.map(async ({ token }) => {
        try {
          await messaging.send({
            token,
            notification: {
              title: notification.title,
              body: notification.message,
            },
            android: {
              notification: {
                sound: "default",
              },
            },
            apns: {
              payload: {
                aps: {
                  sound: "default",
                },
              },
            },
            data: this.toFcmData(notification),
          });
          sent += 1;
        } catch (error: any) {
          failed += 1;
          const code = error?.code || error?.errorInfo?.code;
          if (this.invalidTokenCodes.has(code)) {
            invalidTokens.push(token);
          }
          logger.warn({ err: error, code, userId }, "FCM send failed");
        }
      }),
    );

    if (invalidTokens.length > 0) {
      await prisma.userDeviceToken.updateMany({
        where: { token: { in: invalidTokens } },
        data: { isActive: false },
      });
      logger.info(
        { count: invalidTokens.length },
        "Inactive FCM tokens cleaned up",
      );
    }

    return { sent, failed };
  }

  async sendNotification(data: CreateNotificationDto) {
    const notification = await this.createNotification(data);

    try {
      await this.sendPushNotification(data.userId, {
        ...notification,
        category: data.category,
      });
    } catch (error) {
      logger.error(
        { err: error, userId: data.userId, notificationId: notification.id },
        "Push notification failed",
      );
    }

    return notification;
  }

  async sendNotificationToRoles(
    roleNames: UserRole[],
    data: Omit<CreateNotificationDto, "userId">,
  ) {
    const users = await prisma.user.findMany({
      where: {
        role: { name: { in: roleNames } },
        isDeleted: false,
      },
      select: { id: true },
    });

    return Promise.all(
      users.map((user) =>
        this.sendNotification({
          ...data,
          userId: user.id,
          eventKey: data.eventKey ? `${data.eventKey}:${user.id}` : undefined,
        }),
      ),
    );
  }

  async sendAdminNotificationToUser(data: AdminNotificationDto) {
    if (!data.userId) throw new BadRequestError("User ID is required");
    if (!data.title || !data.message)
      throw new BadRequestError("Title and message are required");

    const user = await prisma.user.findFirst({
      where: { id: data.userId, isDeleted: false },
      select: { id: true },
    });
    if (!user) throw new NotFoundError("User not found");

    return this.sendNotification({
      userId: data.userId,
      type: data.type || "SYSTEM",
      title: data.title,
      message: data.message,
      referenceId: data.referenceId || null,
      referenceType: data.referenceType || "ADMIN",
      data: data.data || {},
      eventKey: `ADMIN_MANUAL:${Date.now()}:${data.userId}`,
    });
  }

  async sendAdminNotificationToAll(data: AdminNotificationDto) {
    if (!data.title || !data.message)
      throw new BadRequestError("Title and message are required");

    const users = await prisma.user.findMany({
      where: { isDeleted: false, status: "ACTIVE" },
      select: { id: true },
    });
    const batchKey = `ADMIN_BROADCAST:${Date.now()}`;

    const notifications = await Promise.all(
      users.map((user) =>
        this.sendNotification({
          userId: user.id,
          type: data.type || "SYSTEM",
          title: data.title,
          message: data.message,
          referenceId: data.referenceId || null,
          referenceType: data.referenceType || "ADMIN",
          data: data.data || {},
          eventKey: `${batchKey}:${user.id}`,
        }),
      ),
    );

    return {
      sentToUsers: notifications.length,
      notifications,
    };
  }

  async getUserNotifications(userId: string, query: any = {}) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const where: any = { userId };

    if (query.isRead !== undefined) {
      where.isRead = String(query.isRead).toLowerCase() === "true";
    }
    if (query.type) {
      where.type = this.normalizeType(String(query.type));
    }

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where }),
    ]);

    return {
      notifications,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUnreadCount(userId: string) {
    const unreadCount = await prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { unreadCount };
  }

  async markAsRead(id: string, userId: string) {
    const notification = await prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!notification)
      throw new NotFoundError("Notification not found or unauthorized");

    return prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  async deleteNotification(id: string, userId: string) {
    const notification = await prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!notification)
      throw new NotFoundError("Notification not found or unauthorized");
    await prisma.notification.delete({ where: { id } });
    return { message: "Notification deleted successfully" };
  }

  async registerDeviceToken(userId: string, data: RegisterDeviceTokenDto) {
    if (!data.token || !data.token.trim()) {
      throw new BadRequestError("FCM token is required");
    }

    return prisma.userDeviceToken.upsert({
      where: { token: data.token },
      update: {
        userId,
        deviceType: data.deviceType,
        deviceName: data.deviceName,
        isActive: true,
        lastUsedAt: new Date(),
      },
      create: {
        userId,
        token: data.token,
        deviceType: data.deviceType,
        deviceName: data.deviceName,
      },
    });
  }

  async removeDeviceToken(userId: string, token: string) {
    if (!token || !token.trim()) {
      throw new BadRequestError("FCM token is required");
    }

    const result = await prisma.userDeviceToken.updateMany({
      where: { userId, token },
      data: { isActive: false },
    });

    if (result.count === 0) {
      throw new NotFoundError("Device token not found");
    }

    return { message: "Device token removed successfully" };
  }
}

import { prisma } from "../../config/database";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import crypto from "crypto";
import Razorpay from "razorpay";
import { NotificationService } from "../notification/notification.service";

export class PaymentService {
  private notificationService = new NotificationService();
  private readonly workerCommissionRate = Number(
    process.env.WORKER_BOOKING_COMMISSION_PERCENT || 10,
  );

  private getReadableRazorpayError(error: any) {
    return (
      error?.error?.description ||
      error?.error?.reason ||
      error?.description ||
      error?.message ||
      "Unable to create Razorpay checkout. Please check Razorpay credentials, amount, currency, and user details."
    );
  }

  private getRazorpayKey() {
    return process.env.RAZORPAY_KEY_ID || "";
  }

  private getRazorpaySecret() {
    return process.env.RAZORPAY_KEY_SECRET || "";
  }

  private getCheckoutDescription(type: "ORDER" | "BOOKING", reference: string) {
    return type === "ORDER"
      ? `Payment for Order #${reference}`
      : `Payment for Booking #${reference}`;
  }

  private getBookingAdvanceAmount(totalAmount: any) {
    return Number(Number(totalAmount).toFixed(2));
  }

  private getAmountInPaise(amount: any) {
    return Math.round(Number(amount) * 100);
  }

  private formatBookingSkillItems(booking: any) {
    return (booking.BookingSkillItem || [])
      .filter((item: any) => item.skillServiceId)
      .map((item: any) => ({
        id: item.id,
        skillServiceId: item.skillServiceId,
        name:
          item.skillNameSnapshot ||
          item.skillService?.name ||
          item.name ||
          "Service",
        description: item.skillService?.description || null,
        estimatedDuration: item.skillService?.estimatedDuration || null,
        price: Number(item.price || 0),
        quantity: item.quantity || 1,
        isAdditional: Boolean(item.isAdditional),
        lineTotal: Number(
          (Number(item.price || 0) * Number(item.quantity || 1)).toFixed(2),
        ),
      }));
  }

  private buildBookingPaymentSummary(booking: any, payableAmount: number) {
    const skillItems = this.formatBookingSkillItems(booking);
    const serviceAmount = Number(booking.subtotal || 0);
    const platformFee = Number(booking.platformFee || 0);
    const discount = Number(booking.discount || 0);
    const totalAmount = Number(booking.totalAmount || 0);
    const remainingAmount = Number((totalAmount - payableAmount).toFixed(2));

    return {
      serviceName:
        booking.skillService?.name ||
        skillItems.find((item: any) => !item.isAdditional)?.name ||
        booking.projectTitle,
      skillName: booking.skill?.name || booking.projectType,
      skillItems,
      currency: "INR",
      serviceAmount,
      platformFee,
      discount,
      totalAmount,
      payableAmount,
      remainingAmount,
      remainingLabel:
        remainingAmount > 0
          ? "Pay remaining after work completion"
          : "Paid online",
    };
  }

  private async getBookingForPaymentSummary(bookingId: string) {
    return prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        Payment: true,
        user: true,
        skill: true,
        skillService: true,
        BookingSkillItem: {
          include: { skillService: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }

  private async creditBookingWorkerEarnings(tx: any, bookingId: string) {
    const existingCount = await tx.workerEarning.count({
      where: { bookingId },
    });
    if (existingCount > 0) return;

    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: {
        BookingWorkerRequest: {
          where: { workerResponse: "ACCEPTED" },
          include: { skillService: true },
        },
        BookingSkillItem: true,
      },
    });
    if (!booking) return;

    for (const request of booking.BookingWorkerRequest || []) {
      if (!request.workerId || !request.skillServiceId) continue;
      const serviceItem = booking.BookingSkillItem.find((item: any) => {
        return (
          item.skillServiceId === request.skillServiceId && !item.rejectedAt
        );
      });
      if (!serviceItem) continue;

      const grossAmount = Number(
        (
          Number(serviceItem.price || 0) * Number(serviceItem.quantity || 1)
        ).toFixed(2),
      );
      const commissionAmount = Number(
        ((grossAmount * this.workerCommissionRate) / 100).toFixed(2),
      );
      const netAmount = Number((grossAmount - commissionAmount).toFixed(2));

      const wallet = await tx.wallet.upsert({
        where: { userId: request.workerId },
        update: { balance: { increment: netAmount } },
        create: { userId: request.workerId, balance: netAmount },
      });

      await tx.workerEarning.upsert({
        where: {
          bookingId_skillServiceId: {
            bookingId,
            skillServiceId: request.skillServiceId,
          },
        },
        update: { grossAmount, commissionAmount, netAmount, status: "PAID" },
        create: {
          workerId: request.workerId,
          bookingId,
          skillServiceId: request.skillServiceId,
          grossAmount,
          commissionAmount,
          netAmount,
          status: "PAID",
        },
      });

      await tx.earning.create({
        data: {
          walletId: wallet.id,
          userId: request.workerId,
          assignmentId: bookingId,
          baseAmount: grossAmount,
          penalty: commissionAmount,
          totalAmount: netAmount,
          settlementStatus: "PAID",
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "CREDIT",
          amount: netAmount,
          description: `Booking earning for ${booking.bookingNumber} - ${request.skillService?.name || "service"}`,
          referenceId: bookingId,
          status: "PAID",
        },
      });

      const pushTitle = "Worker earning credited";
      const pushMessage = `Your ${request.skillService?.name || "service"} earning has been credited for ${booking.bookingNumber}.`;
      const pushData = {
        bookingId,
        skillServiceId: request.skillServiceId,
        amount: netAmount,
      };

      await tx.notification.create({
        data: {
          userId: request.workerId,
          type: "IN_APP",
          title: pushTitle,
          message: pushMessage,
          data: pushData,
        },
      });

      this.notificationService
        .sendPushNotification(request.workerId, {
          title: pushTitle,
          message: pushMessage,
          data: pushData,
        })
        .catch((err) => console.error("Push notification failed", err));
    }
  }

  async getBookingPaymentSummary(bookingId: string, userId: string) {
    const booking = await this.getBookingForPaymentSummary(bookingId);

    if (!booking) throw new NotFoundError("Booking not found");
    if (booking.userId !== userId)
      throw new BadRequestError(
        "Unauthorized to view this booking payment summary",
      );

    const payableAmount = this.getBookingAdvanceAmount(booking.totalAmount);

    return {
      booking: {
        id: booking.id,
        bookingNumber: booking.bookingNumber,
        bookingStatus: booking.bookingStatus,
        workerResponse: booking.workerResponse,
        paymentStatus: booking.paymentStatus,
        paymentMethod: booking.paymentMethod,
        bookingDate: booking.bookingDate,
        startTime: booking.startTime,
        endTime: booking.endTime,
        flexibleTiming: booking.flexibleTiming,
        skill: booking.skill,
        skillService: booking.skillService,
        skillItems: this.formatBookingSkillItems(booking),
        subtotal: Number(booking.subtotal),
        platformFee: Number(booking.platformFee),
        discount: Number(booking.discount),
        totalAmount: Number(booking.totalAmount),
        payableAmount,
      },
      paymentSummary: this.buildBookingPaymentSummary(booking, payableAmount),
      canCheckout:
        booking.workerResponse === "ACCEPTED" &&
        ["ESTIMATE_APPROVED", "PAYMENT_PENDING"].includes(
          String(booking.bookingStatus),
        ) &&
        booking.paymentStatus !== "CAPTURED",
    };
  }

  private async createRazorpayOrder(
    amount: any,
    currency = "INR",
    receiptPrefix = "rcpt",
  ) {
    const amountInPaise = this.getAmountInPaise(amount);
    const key_id = this.getRazorpayKey();
    const key_secret = this.getRazorpaySecret();

    if (!key_id || !key_secret) {
      throw new BadRequestError(
        "Razorpay keys are missing. Cannot create order.",
      );
    }

    const razorpay = new Razorpay({
      key_id,
      key_secret,
    });

    try {
      const order = await razorpay.orders.create({
        amount: amountInPaise,
        currency,
        receipt: `${receiptPrefix}_${Date.now()}`,
      });
      return order.id;
    } catch (error: any) {
      throw new BadRequestError(
        `Razorpay order creation failed: ${this.getReadableRazorpayError(error)}`,
      );
    }
  }

  private async createRazorpayPaymentLink(params: {
    amount: any;
    currency: string;
    description: string;
    referenceId: string;
    user?: any;
    notes?: Record<string, string>;
  }) {
    const key_id = this.getRazorpayKey();
    const key_secret = this.getRazorpaySecret();
    if (!key_id || !key_secret) return null;

    const razorpay = new Razorpay({
      key_id,
      key_secret,
    });
    const user: any = {
      name: params.user?.firstName || params.user?.name || "Constructo User",
    };
    const email = params.user?.email;
    const contact = params.user?.phone || params.user?.contact;
    if (email) user.email = email;
    if (contact) user.contact = contact;

    let paymentLink;
    try {
      paymentLink = await razorpay.paymentLink.create({
        amount: this.getAmountInPaise(params.amount),
        currency: params.currency,
        description: params.description,
        reference_id: params.referenceId,
        user,
        notify: {
          sms: false,
          email: false,
        },
        reminder_enable: false,
        notes: params.notes,
      });
    } catch (error: any) {
      throw new BadRequestError(
        `Razorpay payment link creation failed: ${this.getReadableRazorpayError(error)}`,
      );
    }

    return paymentLink.short_url;
  }

  async formatCheckoutSession(
    payment: any,
    type: "ORDER" | "BOOKING",
    reference: string,
    user?: any,
  ) {
    const amountInPaise = this.getAmountInPaise(payment.amount);
    const description = this.getCheckoutDescription(type, reference);
    const key = this.getRazorpayKey();
    const currency = payment.currency || "INR";
    const checkoutUrl = `https://checkout.razorpay.com/v1/checkout?key=${encodeURIComponent(key)}&order_id=${encodeURIComponent(payment.razorpayOrderId)}&amount=${amountInPaise}&currency=${encodeURIComponent(currency)}`;

    return {
      success: true,
      paymentId: payment.id,
      orderId: payment.orderId,
      bookingId: payment.bookingId,
      razorpayOrderId: payment.razorpayOrderId,
      amount: Number(payment.amount),
      currency,
      key,
      checkoutScriptUrl: "https://checkout.razorpay.com/v1/checkout.js",
      checkoutUrl,
      checkoutOptions: {
        key,
        amount: amountInPaise,
        currency,
        name: "Constructo",
        description,
        order_id: payment.razorpayOrderId,
        prefill: {},
        notes: {
          paymentId: payment.id,
          orderId: payment.orderId,
          bookingId: payment.bookingId,
          type,
        },
      },
      payment,
    };
  }

  async initiatePayment(orderId: string, method: any = "ONLINE") {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { User_Order_userIdToUser: true },
    });
    if (!order) throw new NotFoundError("Order not found");
    if (Number(order.netAmount) <= 0)
      throw new BadRequestError("Order amount must be greater than 0");

    const advanceAmount = Number((Number(order.netAmount) * 0.1).toFixed(2));
    const razorpayOrderId = await this.createRazorpayOrder(
      advanceAmount,
      "INR",
      "order",
    );

    return prisma.payment.create({
      // @ts-ignore
      data: {
        amount: advanceAmount,
        method,
        status: "PENDING",
        orderId,
        userId: order.userId,
        razorpayOrderId,
        currency: "INR",
      },
    });
  }

  async initiateBookingPayment(
    bookingId: string,
    userId: string,
    method: any = "ONLINE",
  ) {
    const booking = await this.getBookingForPaymentSummary(bookingId);

    if (!booking) throw new NotFoundError("Booking not found");
    if (booking.userId !== userId)
      throw new BadRequestError("Unauthorized to checkout this booking");
    if (
      booking.workerResponse !== "ACCEPTED" ||
      !["ESTIMATE_APPROVED", "PAYMENT_PENDING"].includes(booking.bookingStatus)
    ) {
      throw new BadRequestError(
        "Payment is available only after worker accepts the booking and estimate is approved",
      );
    }
    if (booking.paymentStatus === "CAPTURED")
      throw new BadRequestError("Payment already captured for this booking");
    const advanceAmount = this.getBookingAdvanceAmount(booking.totalAmount);

    if (Number(booking.totalAmount) <= 0 || advanceAmount <= 0) {
      throw new BadRequestError(
        "Booking amount must be greater than 0. Please check approved skill services.",
      );
    }

    const formatBookingCheckout = async (payment: any) => ({
      ...(await this.formatCheckoutSession(
        payment,
        "BOOKING",
        booking.bookingNumber,
        booking.user,
      )),
      booking: {
        id: booking.id,
        bookingNumber: booking.bookingNumber,
        bookingStatus: booking.bookingStatus,
        workerResponse: booking.workerResponse,
        bookingDate: booking.bookingDate,
        startTime: booking.startTime,
        endTime: booking.endTime,
        flexibleTiming: booking.flexibleTiming,
        skill: booking.skill,
        skillService: booking.skillService,
        skillItems: this.formatBookingSkillItems(booking),
        subtotal: Number(booking.subtotal),
        platformFee: Number(booking.platformFee),
        discount: Number(booking.discount),
        totalAmount: Number(booking.totalAmount),
        payableAmount: advanceAmount,
        paymentSummary: this.buildBookingPaymentSummary(booking, advanceAmount),
      },
      paymentSummary: this.buildBookingPaymentSummary(booking, advanceAmount),
    });

    if (booking.Payment) {
      const razorpayOrderId = await this.createRazorpayOrder(
        advanceAmount,
        "INR",
        "booking",
      );
      const payment = await prisma.payment.update({
        where: { id: booking.Payment.id },
        data: {
          amount: advanceAmount,
          razorpayOrderId,
        },
      });

      await prisma.booking.update({
        where: { id: booking.id },
        data: { paymentMethod: "ONLINE", bookingStatus: "PAYMENT_PENDING" },
      });

      return formatBookingCheckout(payment);
    }

    const razorpayOrderId = await this.createRazorpayOrder(
      advanceAmount,
      "INR",
      "booking",
    );

    const payment = await prisma.payment.create({
      data: {
        amount: advanceAmount,
        method,
        status: "PENDING",
        bookingId: booking.id,
        userId,
        razorpayOrderId,
        currency: "INR",
      },
    });

    await prisma.booking.update({
      where: { id: booking.id },
      data: { paymentMethod: "ONLINE", bookingStatus: "PAYMENT_PENDING" },
    });

    return formatBookingCheckout(payment);
  }

  private formatTransaction(payment: any) {
    const type = payment.bookingId ? "BOOKING" : "ORDER";
    const user =
      payment.user ||
      payment.Booking?.user ||
      payment.Order?.User_Order_userIdToUser ||
      payment.Order?.user;
    const user = user
      ? {
          id: user.id,
          name: user.firstName || "Unknown",
          email: user.email || "No email",
          phone: user.phone || "No phone",
        }
      : null;

    return {
      id: payment.id,
      type,
      amount: Number(payment.amount),
      method: payment.method,
      status: payment.status,
      currency: payment.currency,
      transactionId: payment.transactionId,
      razorpayOrderId: payment.razorpayOrderId,
      razorpayPaymentId: payment.razorpayPaymentId,
      paidAt: payment.paidAt,
      refundedAt: payment.refundedAt,
      refundReason: payment.refundReason,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      user,
      order: payment.Order
        ? {
            id: payment.Order.id,
            orderNumber: payment.Order.orderNumber,
            status: payment.Order.status,
            totalAmount: Number(payment.Order.totalAmount),
            netAmount: Number(payment.Order.netAmount),
            items: payment.Order.OrderItem?.map((item: any) => ({
              id: item.id,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: Number(item.unitPrice),
              totalPrice: Number(item.totalPrice),
              productName: item.Product?.name,
            })),
          }
        : null,
      booking: payment.Booking
        ? {
            id: payment.Booking.id,
            bookingNumber: payment.Booking.bookingNumber,
            status: payment.Booking.bookingStatus,
            workerResponse: payment.Booking.workerResponse,
            projectType: payment.Booking.projectType,
            bookingDate: payment.Booking.bookingDate,
            startTime: payment.Booking.startTime,
            endTime: payment.Booking.endTime,
            flexibleTiming: payment.Booking.flexibleTiming,
            totalHours: Number(payment.Booking.totalHours),
            hourlyRate: Number(payment.Booking.hourlyRate),
            subtotal: Number(payment.Booking.subtotal),
            commissionAmount: Number(payment.Booking.platformFee),
            totalAmount: Number(payment.Booking.totalAmount),
            worker: payment.Booking.worker,
            address: payment.Booking.address,
          }
        : null,
    };
  }

  private buildTransactionWhere(query: any = {}, userId?: string) {
    const type = String(query.type || "").toUpperCase();
    const status = query.status
      ? String(query.status).toUpperCase()
      : undefined;
    const where: any = {};

    if (userId) {
      where.OR = [{ userId }, { Order: { userId } }, { Booking: { userId } }];
    }

    if (query.userId) {
      where.OR = [
        { userId: String(query.userId) },
        { Order: { userId: String(query.userId) } },
        { Booking: { userId: String(query.userId) } },
      ];
    }

    if (type === "ORDER") where.bookingId = null;
    if (type === "BOOKING") where.orderId = null;
    if (status) where.status = status;
    if (query.orderId) where.orderId = String(query.orderId);
    if (query.bookingId) where.bookingId = String(query.bookingId);

    return where;
  }

  private getPagination(query: any = {}) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 100);
    const skip = (page - 1) * limit;
    return { page, limit, skip };
  }

  async getUserTransactions(userId: string, query: any = {}) {
    const { page, limit, skip } = this.getPagination(query);
    const where = this.buildTransactionWhere(query, userId);

    const [payments, total] = await prisma.$transaction([
      prisma.payment.findMany({
        where,
        include: {
          Order: true,
          Booking: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.payment.count({ where }),
    ]);

    return {
      transactions: payments.map((payment) => this.formatTransaction(payment)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getAdminTransactions(query: any = {}) {
    const { page, limit, skip } = this.getPagination(query);
    const where = this.buildTransactionWhere(query);

    const [payments, total] = await prisma.$transaction([
      prisma.payment.findMany({
        where,
        include: {
          Order: true,
          Booking: {
            include: {
              user: {
                select: { id: true, firstName: true, phone: true, email: true },
              },
              worker: {
                select: { id: true, firstName: true, phone: true, email: true },
              },
              address: true,
            },
          },
          user: {
            select: { id: true, firstName: true, phone: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.payment.count({ where }),
    ]);

    return {
      transactions: payments.map((payment) => this.formatTransaction(payment)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUserTransactionById(userId: string, id: string) {
    const payment = await prisma.payment.findFirst({
      where: {
        id,
        OR: [{ userId }, { Order: { userId } }, { Booking: { userId } }],
      },
      include: {
        Order: {
          include: {
            OrderItem: {
              include: {
                Product: true,
              },
            },
          },
        },
        Booking: {
          include: {
            worker: {
              select: { id: true, firstName: true, phone: true, email: true },
            },
            address: true,
          },
        },
      },
    });

    if (!payment) throw new NotFoundError("Transaction not found");
    return this.formatTransaction(payment);
  }

  async getAdminTransactionById(id: string) {
    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, firstName: true, phone: true, email: true },
        },
        Order: {
          include: {
            User_Order_userIdToUser: {
              select: { id: true, firstName: true, phone: true, email: true },
            },
            OrderItem: {
              include: {
                Product: true,
              },
            },
          },
        },
        Booking: {
          include: {
            user: {
              select: { id: true, firstName: true, phone: true, email: true },
            },
            worker: {
              select: { id: true, firstName: true, phone: true, email: true },
            },
            address: true,
          },
        },
      },
    });

    if (!payment) throw new NotFoundError("Transaction not found");
    return this.formatTransaction(payment);
  }

  private isValidRazorpaySignature(
    orderId: string,
    paymentId: string,
    signature?: string,
  ): boolean {
    const secret = this.getRazorpaySecret();
    if (!secret || !signature) return false;

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    const expected = Buffer.from(expectedSignature, "hex");
    const supplied = Buffer.from(signature, "hex");
    return (
      supplied.length === expected.length &&
      crypto.timingSafeEqual(expected, supplied)
    );
  }

  async verifyPayment(paymentId: string, data: any) {
    const existingPayment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!existingPayment) throw new NotFoundError("Payment not found");

    const razorpayPaymentId = data.razorpayPaymentId || data.transactionId;
    const razorpayOrderId =
      data.razorpayOrderId || existingPayment.razorpayOrderId;
    const razorpaySignature = data.razorpaySignature;

    if (!razorpayPaymentId || !razorpayOrderId) {
      throw new BadRequestError(
        "Razorpay order ID and payment ID are required",
      );
    }

    if (
      !this.isValidRazorpaySignature(
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
      )
    ) {
      await prisma.payment.update({
        where: { id: paymentId },
        data: { status: "FAILED" },
      });
      if (existingPayment.userId) {
        await this.notificationService.sendNotification({
          userId: existingPayment.userId,
          type: "PAYMENT_FAILED",
          title: "Payment Failed",
          message: "Your payment could not be verified.",
          referenceId: paymentId,
          referenceType: existingPayment.bookingId
            ? "BOOKING_PAYMENT"
            : "ORDER_PAYMENT",
        });
      }
      await this.notificationService.sendNotificationToRoles(
        ["ADMIN", "SUPER_ADMIN"],
        {
          type: "PAYMENT_FAILED",
          title: "Payment Failed",
          message: "A user payment could not be verified.",
          referenceId: paymentId,
          referenceType: existingPayment.bookingId
            ? "BOOKING_PAYMENT"
            : "ORDER_PAYMENT",
          eventKey: `ADMIN_PAYMENT_FAILED:PAYMENT:${paymentId}`,
        },
      );
      throw new BadRequestError("Invalid Razorpay signature");
    }

    const verifiedPayment = await prisma.$transaction(async (tx: any) => {
      const payment = await tx.payment.update({
        where: { id: paymentId },
        data: {
          transactionId: razorpayPaymentId,
          razorpayOrderId,
          razorpayPaymentId,
          razorpaySignature,
          status: existingPayment.bookingId ? "CAPTURED" : "SUCCESS",
          paidAt: new Date(),
        },
      });

      if (payment.orderId) {
        const orderData = await tx.order.update({
          where: { id: payment.orderId },
          data: { status: "PENDING_ADMIN_ASSIGNMENT" },
        });

        // Find and empty the user's cart
        const cart = await tx.cart.findUnique({
          where: { userId: orderData.userId },
        });
        if (cart) {
          await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        }

        await tx.orderTimeline.create({
          data: {
            orderId: payment.orderId,
            status: "ORDER_CREATED",
            title: "Order Placed Successfully",
            metadata: {
              paymentId: payment.id,
              razorpayOrderId,
              razorpayPaymentId,
            },
          },
        });

        await tx.orderTimeline.create({
          data: {
            orderId: payment.orderId,
            status: "WAITING_FOR_VENDOR",
            title: "Waiting for admin vendor assignment",
          },
        });

        await tx.auditLog.create({
          data: {
            action: "PAYMENT_VERIFIED",
            entityType: "Payment",
            entityId: payment.id,
            orderId: payment.orderId,
            metadata: { razorpayOrderId, razorpayPaymentId },
          },
        });
      }

      if (payment.bookingId) {
        await tx.booking.update({
          where: { id: payment.bookingId },
          data: { paymentStatus: "CAPTURED" },
        });
        await this.creditBookingWorkerEarnings(tx, payment.bookingId);
      }

      return payment;
    });

    if (verifiedPayment.userId) {
      await this.notificationService.sendNotification({
        userId: verifiedPayment.userId,
        type: "PAYMENT_SUCCESS",
        title: "Payment Successful",
        message: verifiedPayment.bookingId
          ? "Your booking payment has been captured successfully."
          : "Your order payment has been completed successfully.",
        referenceId: verifiedPayment.id,
        referenceType: verifiedPayment.bookingId
          ? "BOOKING_PAYMENT"
          : "ORDER_PAYMENT",
      });
    }

    return verifiedPayment;
  }

  async refundPayment(paymentId: string, actorId: string, reason?: string) {
    const existingPayment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!existingPayment) throw new NotFoundError("Payment not found");
    if (
      !["SUCCESS", "COMPLETED", "CAPTURED"].includes(existingPayment.status)
    ) {
      throw new BadRequestError("Only successful payments can be refunded");
    }

    return prisma.$transaction(async (tx: any) => {
      const payment = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: "REFUNDED",
          refundedAt: new Date(),
          refundReason: reason,
        },
      });

      if (payment.orderId) {
        await tx.order.update({
          where: { id: payment.orderId },
          data: { status: "CANCELLED" },
        });

        await tx.orderTimeline.create({
          data: {
            orderId: payment.orderId,
            status: "CANCELLED",
            title: "Payment refunded",
            message: reason,
          },
        });

        await tx.auditLog.create({
          data: {
            actorId,
            action: "PAYMENT_REFUNDED",
            entityType: "Payment",
            entityId: payment.id,
            orderId: payment.orderId,
            metadata: { reason },
          },
        });
      }

      if (payment.bookingId) {
        await tx.booking.update({
          where: { id: payment.bookingId },
          data: { paymentStatus: "REFUNDED" },
        });
      }

      return payment;
    });
  }

  async processAdminRefund(orderId: string, actorId: string) {
    const refundRecord = await prisma.refund.findUnique({
      where: { orderId },
      include: { order: true, payment: true },
    });

    if (!refundRecord) {
      throw new NotFoundError("No eligible refund found for this order");
    }

    if (refundRecord.status === "REFUNDED") {
      throw new BadRequestError("Refund already completed for this order");
    }

    if (refundRecord.status === "PROCESSING") {
      throw new BadRequestError("Refund is already processing");
    }

    if (!refundRecord.payment.razorpayPaymentId) {
      throw new BadRequestError("No Razorpay payment ID found to refund");
    }

    try {
      await prisma.refund.update({
        where: { id: refundRecord.id },
        data: { status: "PROCESSING" },
      });

      const razorpay = new Razorpay({
        key_id: this.getRazorpayKey(),
        key_secret: this.getRazorpaySecret(),
      });

      const rzpRefund = await razorpay.payments.refund(
        refundRecord.payment.razorpayPaymentId,
        {
          amount: this.getAmountInPaise(refundRecord.amount),
          speed: "normal",
          notes: {
            orderId,
            reason: refundRecord.reason || "Admin cancellation",
          },
        },
      );

      await prisma.$transaction(async (tx: any) => {
        await tx.refund.update({
          where: { id: refundRecord.id },
          data: {
            status: "REFUNDED",
            gatewayRefundId: rzpRefund.id,
          },
        });

        await tx.payment.update({
          where: { id: refundRecord.paymentId },
          data: {
            status: "REFUNDED",
            refundedAt: new Date(),
            refundReason: refundRecord.reason,
          },
        });

        await tx.orderTimeline.create({
          data: {
            orderId,
            status: "CANCELLED",
            title: "Refund processed successfully",
            message: `Amount: ₹${refundRecord.amount}`,
            metadata: { gatewayRefundId: rzpRefund.id },
          },
        });

        await tx.auditLog.create({
          data: {
            actorId,
            action: "ADMIN_REFUND_PROCESSED",
            entityType: "Refund",
            entityId: refundRecord.id,
            orderId,
            metadata: { gatewayRefundId: rzpRefund.id },
          },
        });
      });

      return { success: true, message: "Refund processed successfully" };
    } catch (error: any) {
      await prisma.refund.update({
        where: { id: refundRecord.id },
        data: { status: "FAILED" },
      });

      throw new BadRequestError(
        `Refund failed: ${this.getReadableRazorpayError(error)}`,
      );
    }
  }
}

import { Request, Response } from "express";
import { PaymentService } from "./payment.service";

const paymentService = new PaymentService();

export class PaymentController {
  async getTransactions(req: Request, res: Response) {
    try {
      const transactions = await paymentService.getUserTransactions(
        req.user.userId,
        req.query,
      );
      res.status(200).json({ success: true, data: transactions });
    } catch (error: any) {
      res
        .status(error.statusCode || 500)
        .json({ success: false, message: error.message });
    }
  }

  async getTransactionDetails(req: Request, res: Response) {
    try {
      const transaction = await paymentService.getUserTransactionById(
        req.user.userId,
        String(req.params.id),
      );
      res.status(200).json({ success: true, data: transaction });
    } catch (error: any) {
      res
        .status(error.statusCode || 500)
        .json({ success: false, message: error.message });
    }
  }

  async getAdminTransactions(req: Request, res: Response) {
    try {
      const transactions = await paymentService.getAdminTransactions(req.query);
      res.status(200).json({ success: true, data: transactions });
    } catch (error: any) {
      res
        .status(error.statusCode || 500)
        .json({ success: false, message: error.message });
    }
  }

  async getAdminTransactionDetails(req: Request, res: Response) {
    try {
      const transaction = await paymentService.getAdminTransactionById(
        String(req.params.id),
      );
      res.status(200).json({ success: true, data: transaction });
    } catch (error: any) {
      res
        .status(error.statusCode || 500)
        .json({ success: false, message: error.message });
    }
  }

  async initiate(req: Request, res: Response) {
    try {
      const { orderId, method } = req.body;
      const payment = await paymentService.initiatePayment(orderId, method);
      res
        .status(201)
        .json({ success: true, message: "Payment initiated", data: payment });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async verify(req: Request, res: Response) {
    try {
      const paymentId = req.params.id || req.body.paymentId;
      const payment = await paymentService.verifyPayment(
        String(paymentId),
        req.body,
      );
      res
        .status(200)
        .json({ success: true, message: "Payment verified", data: payment });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async refund(req: Request, res: Response) {
    try {
      const payment = await paymentService.refundPayment(
        String(req.params.id),
        req.user.userId,
        req.body.reason,
      );
      res
        .status(200)
        .json({ success: true, message: "Payment refunded", data: payment });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }
}

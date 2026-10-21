import { z } from "zod";

export const verifyPaymentSchema = z.object({
  body: z
    .object({
      orderId: z.string().min(1).optional(),
      paymentId: z.string().min(1).optional(),
      signature: z.string().min(1).optional(),
      razorpayOrderId: z.string().min(1).optional(),
      razorpayPaymentId: z.string().min(1).optional(),
      razorpaySignature: z.string().min(1).optional(),
    })
    .refine((body) => body.orderId || body.razorpayOrderId, {
      message: "orderId is required",
    })
    .refine((body) => body.paymentId || body.razorpayPaymentId, {
      message: "paymentId is required",
    })
    .refine((body) => body.signature || body.razorpaySignature, {
      message: "signature is required",
    }),
  query: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
});

export const paymentStatusSchema = z.object({
  body: z.object({}).passthrough(),
  query: z.object({}).passthrough(),
  params: z.object({
    orderId: z.string().min(1),
  }),
});

export const refundPaymentSchema = z.object({
  body: z.object({
    reason: z.string().max(500).optional(),
  }),
  query: z.object({}).passthrough(),
  params: z.object({
    id: z.string().uuid(),
  }),
});

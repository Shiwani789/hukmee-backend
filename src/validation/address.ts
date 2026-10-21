import { z } from "zod";

const addressFields = {
  label: z.string().trim().max(60).optional(),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().min(1).max(20),
  countryCode: z
    .string()
    .trim()
    .length(2)
    .transform((value) => value.toUpperCase()),
};

const phone = z
  .string()
  .trim()
  .min(7)
  .max(24)
  .regex(/^\+?[0-9]{7,24}$/, "Provide a valid phone number");
const coordinates = {
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
};
const validateCoordinates = (
  value: {
    latitude?: number | undefined;
    longitude?: number | undefined;
  },
  context: z.RefinementCtx,
) => {
  if ((value.latitude === undefined) !== (value.longitude === undefined)) {
    context.addIssue({
      code: "custom",
      message: "Latitude and longitude must be provided together",
      path: [value.latitude === undefined ? "latitude" : "longitude"],
    });
  }
  if (value.latitude === 0 && value.longitude === 0) {
    context.addIssue({
      code: "custom",
      message: "Latitude and longitude cannot both be zero",
      path: ["latitude"],
    });
  }
};

const customerAddressCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone,
    type: z.enum(["HOME", "WORK", "OTHER"]),
    addressLine1: z.string().trim().min(1).max(200),
    addressLine2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(100),
    state: z.string().trim().min(1).max(100),
    country: z.string().trim().min(1).max(100),
    pincode: z.string().trim().min(1).max(20),
    ...coordinates,
    isDefault: z.boolean().default(false),
  })
  .superRefine(validateCoordinates)
  .transform((value) => ({
    recipientName: value.name,
    phone: value.phone,
    type: value.type,
    line1: value.addressLine1,
    line2: value.addressLine2,
    city: value.city,
    region: value.state,
    country: value.country,
    countryCode: undefined,
    postalCode: value.pincode,
    latitude: value.latitude,
    longitude: value.longitude,
    isDefault: value.isDefault,
    label: undefined,
  }));

const legacyAddressCreateSchema = z
  .object({
    label: addressFields.label,
    line1: addressFields.line1,
    line2: addressFields.line2,
    city: addressFields.city,
    region: addressFields.region,
    postalCode: addressFields.postalCode,
    countryCode: addressFields.countryCode,
  })
  .transform((value) => ({
    recipientName: undefined,
    phone: undefined,
    type: "HOME" as const,
    label: value.label,
    line1: value.line1,
    line2: value.line2,
    city: value.city,
    region: value.region,
    country: value.countryCode,
    countryCode: value.countryCode,
    postalCode: value.postalCode,
    latitude: undefined,
    longitude: undefined,
    isDefault: false,
  }));

export const createAddressSchema = z.object({
  body: z.union([customerAddressCreateSchema, legacyAddressCreateSchema]),
  params: z.object({}),
  query: z.object({}),
});

export const updateAddressSchema = z.object({
  body: z
    .object({
      label: addressFields.label,
      line1: addressFields.line1.optional(),
      line2: addressFields.line2,
      city: addressFields.city.optional(),
      region: addressFields.region,
      postalCode: addressFields.postalCode.optional(),
      countryCode: addressFields.countryCode.optional(),
    })
    .refine((value) => Object.keys(value).length > 0),
  params: z.object({ addressId: z.uuid() }),
  query: z.object({}),
});

export const addressIdSchema = z.object({
  body: z.object({}),
  params: z.object({ addressId: z.uuid() }),
  query: z.object({}),
});

export type CreateAddressInput = z.infer<typeof createAddressSchema>["body"];
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>["body"];

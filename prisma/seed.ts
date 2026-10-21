import "dotenv/config";
import argon2 from "argon2";
import chalk from "chalk";
import { PrismaClient, UserRole } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  if (process.env.NODE_ENV !== "development")
    throw new Error("Seed is restricted to NODE_ENV=development");
  console.log(chalk.cyan("🌱 Starting HUKMEE development seed..."));
  for (const name of Object.values(UserRole)) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
    console.log(chalk.green(`  ✓ Role ready: ${name}`));
  }

  // Match Constructo's action/resource permission model.
  const permissions = [
    ["users", "manage", "Manage user accounts and roles"],
    ["catalog", "manage", "Manage device and repair service catalogue"],
    ["bookings", "manage", "Manage repair bookings and assignments"],
    ["inventory", "manage", "View and manage repair parts inventory"],
    ["audit", "read", "Read audit records"],
  ] as const;
  for (const [resource, action, description] of permissions) {
    const permission = await prisma.permission.upsert({
      where: { action_resource: { action, resource } },
      update: { description },
      create: { action, resource, description },
    });
    for (const roleName of [UserRole.SUPER_ADMIN, UserRole.ADMIN]) {
      await prisma.role.update({
        where: { name: roleName },
        data: { permissions: { connect: { id: permission.id } } },
      });
    }
    console.log(chalk.green(`  ✓ Permission ready: ${resource}:${action}`));
  }

  // Constructo seeds construction categories. HUKMEE's equivalent is the
  // repair-service category catalog, so use repair-specific sample data.
  const repairCategories = [
    "Screen Repair",
    "Battery Replacement",
    "Charging Port Repair",
    "Camera Repair",
    "Speaker and Microphone Repair",
    "Water Damage Repair",
    "Software Troubleshooting",
    "Device Diagnostics",
    "Data Recovery",
    "Button and Sensor Repair",
  ];
  for (const name of repairCategories) {
    await prisma.repairCategory.upsert({
      where: { name },
      update: { active: true },
      create: { name, active: true },
    });
    console.log(chalk.green(`  ✓ Repair category ready: ${name}`));
  }

  // Constructo's construction-material brands are mapped to phone brands.
  const deviceBrands = [
    "Apple",
    "Samsung",
    "Xiaomi",
    "OnePlus",
    "Google",
    "Motorola",
  ];
  for (const name of deviceBrands) {
    await prisma.brand.upsert({
      where: { name },
      update: { active: true },
      create: { name, active: true },
    });
    console.log(chalk.green(`  ✓ Device brand ready: ${name}`));
  }

  const configuredUsers = [
    {
      roleName: UserRole.SUPER_ADMIN,
      // Development-only credentials, matching the Constructo seed pattern.
      email: "admin@hukmee.local",
      password: "Hukmee@Admin123",
      displayName: "Hukmee Super Admin",
    },
    {
      roleName: UserRole.ADMIN,
      email: process.env.SEED_ADMIN_EMAIL,
      password: process.env.SEED_ADMIN_PASSWORD,
      displayName: process.env.SEED_ADMIN_NAME ?? "Hukmee Admin",
    },
    {
      roleName: UserRole.VENDOR,
      email: process.env.SEED_VENDOR_EMAIL,
      password: process.env.SEED_VENDOR_PASSWORD,
      displayName: process.env.SEED_VENDOR_NAME ?? "Hukmee Vendor",
    },
    {
      roleName: UserRole.WORKER,
      email: process.env.SEED_TECHNICIAN_EMAIL,
      password: process.env.SEED_TECHNICIAN_PASSWORD,
      displayName: process.env.SEED_TECHNICIAN_NAME ?? "Hukmee Technician",
    },
    {
      roleName: UserRole.DELIVERY_PARTNER,
      email: process.env.SEED_DELIVERY_PARTNER_EMAIL,
      password: process.env.SEED_DELIVERY_PARTNER_PASSWORD,
      displayName:
        process.env.SEED_DELIVERY_PARTNER_NAME ?? "Hukmee Delivery Partner",
    },
    // Development sample vendors stay in DRAFT KYC; the seed must not bypass
    // HUKMEE's vendor approval flow as the Constructo sample did.
    ...[
      { name: "Hukmee Mobile Care", email: "vendor1@hukmee.local" },
      { name: "City Phone Repair", email: "vendor2@hukmee.local" },
      { name: "QuickFix Devices", email: "vendor3@hukmee.local" },
      { name: "Trusted Tech Service", email: "vendor4@hukmee.local" },
    ].map((vendor) => ({
      roleName: UserRole.VENDOR,
      email: vendor.email,
      password: "Hukmee@Vendor123",
      displayName: vendor.name,
      createVendorKyc: true,
    })),
  ];

  for (const account of configuredUsers) {
    if (!account.email && !account.password) continue;
    const email = account.email?.trim().toLowerCase();
    if (!email || !account.password || account.password.length < 12)
      throw new Error(
        `Set both the email and password for ${account.roleName}; password must be at least 12 characters`,
      );
    const role = await prisma.role.findUniqueOrThrow({
      where: { name: account.roleName },
    });
    const password = await argon2.hash(account.password);
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        password,
        isActive: true,
        isDeleted: false,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        role: { connect: { id: role.id } },
        displayName: account.displayName,
        firstName: account.displayName,
      },
      create: {
        email,
        password,
        isActive: true,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        role: { connect: { id: role.id } },
        displayName: account.displayName,
        firstName: account.displayName,
      },
    });
    if (account.roleName === UserRole.WORKER)
      await prisma.technicianProfile.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id },
      });
    if ("createVendorKyc" in account && account.createVendorKyc) {
      await prisma.vendorKycApplication.upsert({
        where: { vendorUserId: user.id },
        update: {},
        create: { vendorUserId: user.id },
      });
    }
    console.log(chalk.green(`  ✓ ${account.roleName} account ready: ${email}`));
  }
  console.log(chalk.cyan.bold("🎉 HUKMEE seed completed successfully."));
}
main()
  .catch((error) => {
    console.error(chalk.red("✖ HUKMEE seed failed:"), error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

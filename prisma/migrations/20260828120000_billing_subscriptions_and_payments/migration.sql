-- Billing: subscriptions, payment orders, and the gateway event log.
--
-- Risk: none. Purely additive — three new tables and their foreign keys. No
-- existing table is altered, no column is narrowed, no UNIQUE index is added to
-- data that already exists, so there is nothing here that can fail on a
-- populated database and nothing to check beforehand.
--
-- The `Tenant.subscription` / `Tenant.paymentOrders` / `Tenant.paymentEvents`
-- fields added to schema.prisma in the same change are virtual relation fields.
-- They produce no columns on `Tenant`; the foreign keys all live on the new
-- tables, which is why `Tenant` is untouched below.
--
-- Money is stored as INTEGER counts of minor units (US cents) rather than
-- DECIMAL(12,2). See the BILLING & PAYMENTS section of schema.prisma for why.
--
-- Rollback, if ever needed (destroys all payment history):
--   DROP TABLE `PaymentEvent`; DROP TABLE `PaymentOrder`; DROP TABLE `Subscription`;

-- CreateTable
CREATE TABLE `Subscription` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `billingCycle` VARCHAR(191) NOT NULL DEFAULT 'monthly',
    `status` VARCHAR(191) NOT NULL DEFAULT 'incomplete',
    `currency` VARCHAR(191) NOT NULL DEFAULT 'USD',
    `currentPeriodStart` DATETIME(3) NULL,
    `currentPeriodEnd` DATETIME(3) NULL,
    `cancelAtPeriodEnd` BOOLEAN NOT NULL DEFAULT false,
    `canceledAt` DATETIME(3) NULL,
    `setupFeePaidPlanId` VARCHAR(191) NULL,
    `setupFeePaidAt` DATETIME(3) NULL,
    `lastPaymentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Subscription_tenantId_key`(`tenantId`),
    INDEX `Subscription_status_currentPeriodEnd_idx`(`status`, `currentPeriodEnd`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentOrder` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `subscriptionId` VARCHAR(191) NULL,
    `reference` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `planId` VARCHAR(191) NOT NULL,
    `billingCycle` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `currency` VARCHAR(191) NOT NULL,
    `planAmountMinor` INTEGER NOT NULL,
    `setupFeeMinor` INTEGER NOT NULL DEFAULT 0,
    `amountMinor` INTEGER NOT NULL,
    `lineItems` JSON NOT NULL,
    `gateway` VARCHAR(191) NOT NULL DEFAULT 'safepay',
    `gatewayEnvironment` VARCHAR(191) NOT NULL,
    `tracker` VARCHAR(128) NULL,
    `referenceCode` VARCHAR(128) NULL,
    `paidAt` DATETIME(3) NULL,
    `failureReason` TEXT NULL,
    `periodStart` DATETIME(3) NULL,
    `periodEnd` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PaymentOrder_reference_key`(`reference`),
    UNIQUE INDEX `PaymentOrder_tracker_key`(`tracker`),
    INDEX `PaymentOrder_tenantId_createdAt_idx`(`tenantId`, `createdAt` DESC),
    INDEX `PaymentOrder_subscriptionId_idx`(`subscriptionId`),
    INDEX `PaymentOrder_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentEvent` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `source` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `dedupeKey` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PaymentEvent_dedupeKey_key`(`dedupeKey`),
    INDEX `PaymentEvent_orderId_createdAt_idx`(`orderId`, `createdAt` DESC),
    INDEX `PaymentEvent_tenantId_createdAt_idx`(`tenantId`, `createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentOrder` ADD CONSTRAINT `PaymentOrder_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentOrder` ADD CONSTRAINT `PaymentOrder_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentEvent` ADD CONSTRAINT `PaymentEvent_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentEvent` ADD CONSTRAINT `PaymentEvent_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `PaymentOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

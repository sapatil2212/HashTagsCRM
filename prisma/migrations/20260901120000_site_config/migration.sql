-- Global site configuration (CMS). Single row, id is always 1.
--
-- This table backs the super-admin CMS (/super-admin/cms): branding, logos,
-- contact details, SEO, pricing overrides, footer/legal, maintenance mode and
-- custom <head> scripts.
--
-- The `SiteConfig` Prisma model has existed in schema.prisma, but NO migration
-- ever created the table. Because the Prisma client is generated from the
-- schema (not from migrations), `prisma.siteConfig` type-checked and compiled,
-- yet every query hit a table that does not exist (MySQL 1146 -> Prisma P2021):
--   - updateSiteConfig() -> upsert threw -> the CMS save endpoint returned 500
--     and nothing persisted;
--   - getSiteConfig() -> findUnique threw -> was caught and silently fell back
--     to DEFAULT_CONFIG, so the public site always rendered the hardcoded
--     defaults and logos/content never changed.
-- Creating the table repairs the whole save -> DB -> read -> refresh chain.
--
-- Risk: none. Purely additive — one new table, no foreign keys, nothing else
-- touched, so there is nothing here that can fail on a populated database. The
-- id=1 row is created lazily by updateSiteConfig()'s upsert on the first save.
--
-- Rollback (discards all CMS settings):
--   DROP TABLE `SiteConfig`;

-- CreateTable
CREATE TABLE `SiteConfig` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,
    `siteName` VARCHAR(120) NULL,
    `tagline` VARCHAR(255) NULL,
    `logoUrl` VARCHAR(500) NULL,
    `logoDarkUrl` VARCHAR(500) NULL,
    `faviconUrl` VARCHAR(500) NULL,
    `primaryColor` VARCHAR(12) NULL,
    `accentColor` VARCHAR(12) NULL,
    `contactEmail` VARCHAR(255) NULL,
    `contactPhone` VARCHAR(60) NULL,
    `contactAddress` VARCHAR(500) NULL,
    `supportUrl` VARCHAR(500) NULL,
    `twitterUrl` VARCHAR(500) NULL,
    `linkedinUrl` VARCHAR(500) NULL,
    `metaTitle` VARCHAR(120) NULL,
    `metaDescription` VARCHAR(320) NULL,
    `ogImageUrl` VARCHAR(500) NULL,
    `planOverrides` JSON NULL,
    `billingCurrency` VARCHAR(8) NULL,
    `footerTagline` VARCHAR(255) NULL,
    `privacyPolicyUrl` VARCHAR(500) NULL,
    `termsUrl` VARCHAR(500) NULL,
    `copyrightText` VARCHAR(255) NULL,
    `maintenanceMode` BOOLEAN NOT NULL DEFAULT false,
    `maintenanceMessage` VARCHAR(500) NULL,
    `analyticsId` VARCHAR(80) NULL,
    `liveChatId` VARCHAR(160) NULL,
    `customHeadHtml` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

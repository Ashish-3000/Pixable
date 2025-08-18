/*
  Warnings:

  - You are about to drop the column `point` on the `Usage` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Usage" DROP COLUMN "point",
ADD COLUMN     "points" INTEGER NOT NULL DEFAULT 0;

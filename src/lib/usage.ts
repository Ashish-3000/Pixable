import { RateLimiterPrisma } from "rate-limiter-flexible";

import { prisma } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";

const FREE_POINTS = 5;
const PRO_POINTS = 100;
const DURATION = 30 * 24 * 60 * 60; // 30 days
const GENERATION_COST = 1;

export async function getUsageTracker() {
  const { has } = await auth();
  const hasProAccess = has({ plan: "pro" });

  const usageTracker = new RateLimiterPrisma({
    storeClient: prisma,
    tableName: "Usage", // Make sure this matches your @@map("Usage")
    points: hasProAccess ? PRO_POINTS : FREE_POINTS,
    duration: DURATION,
  });

  return usageTracker;
}

export async function consumeCredits() {
  const { userId } = await auth();

  console.log("consumeCredits called for userId:", userId); // Debug log

  if (!userId) {
    console.error("No userId found in auth");
    throw new Error("User not authenticated");
  }

  try {
    const usageTracker = await getUsageTracker();
    console.log("Usage tracker created successfully"); // Debug log
    
    const result = await usageTracker.consume(userId, GENERATION_COST);
    console.log("Credits consumed successfully:", result); // Debug log
    
    return result;
  } catch (error) {
    console.error("Error in consumeCredits:", error); // Debug log
    throw error; // Re-throw the original error
  }
}

export async function getUsageStatus() {
  const { userId } = await auth();

  console.log("getUsageStatus called for userId:", userId); // Debug log

  if (!userId) {
    console.error("No userId found in auth");
    throw new Error("User not authenticated");
  }

  try {
    const usageTracker = await getUsageTracker();
    console.log("Usage tracker created for status check"); // Debug log
    
    const result = await usageTracker.get(userId);
    console.log("Usage status retrieved:", result); // Debug log
    
    return result;
  } catch (error) {
    console.error("Error in getUsageStatus:", error); // Debug log
    throw error; // Re-throw the original error
  }
}
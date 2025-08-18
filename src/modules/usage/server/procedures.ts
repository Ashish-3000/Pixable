import { getUsageStatus } from "@/lib/usage";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";

export const usageRouter = createTRPCRouter({
  status: protectedProcedure.query(async () => {
    try {
      console.log("Fetching usage status..."); // Debug log
      const result = await getUsageStatus();
      console.log("Usage status result:", result); // Debug log
      return result;
    } catch (error) {
      console.error("Usage status error:", error); // See the actual error
      
      // Instead of returning null, throw a more descriptive error
      throw new Error(`Failed to fetch usage status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }),
});
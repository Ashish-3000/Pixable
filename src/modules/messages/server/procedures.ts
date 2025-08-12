import { Input } from "@/components/ui/input";
import { baseProcedure, createTRPCRouter } from "@/trpc/init";
import { create } from "domain";
import { prisma } from "../../../lib/db";
import { inngest } from "@/inngest/client";
import { z } from "zod";

export const messagesRouter = createTRPCRouter({
    getMany: baseProcedure.query(async () => {
        const messages = await prisma.message.findMany({
            orderBy: {
                updatedAt: "desc"
            },
        })
        return messages;
    }),
    create: baseProcedure.input(
        z.object({
            value: z.string()
                .min(1, { message: "Message cannot be empty" })
                .max(10000, { message: "Message is too long" }),
            projectId: z.string().min(1, { message: "Project ID is required" }),
        })
    ).mutation(async ({ input }) => {
        const createdMessage = await prisma.message.create({
            data: {
                projectId: input.projectId,
                content: input.value,
                role: "USER",
                type: "RESULT"
            }
        })

        await inngest.send({
            name: "code-agent/run",
            data: {
                value: input.value,
                project: input.projectId,
            },
        })

        return createdMessage;
    })
})
import { Input } from "@/components/ui/input";
import { protectedProcedure, createTRPCRouter } from "@/trpc/init";
import { create } from "domain";
import { prisma } from "../../../lib/db";
import { inngest } from "@/inngest/client";
import { z } from "zod";
import { generateSlug } from "random-word-slugs";
import { TRPCError } from "@trpc/server";
import { consumeCredits } from "@/lib/usage";

export const projectsRouter = createTRPCRouter({
    getOne: protectedProcedure.
        input(z.object({
            id: z.string().min(1, { message: "Project ID is required" })
        }))
        .query(async ({ input, ctx }) => {
            const existingProject = await prisma.project.findUnique({
                where: {
                    id: input.id,
                    userId: ctx.auth.userId
                },
            })

            if (!existingProject) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
            }
            return existingProject;
        }),
    getMany: protectedProcedure.query(async ({ctx}) => {
        const projects = await prisma.project.findMany({
            where:{
               userId: ctx.auth.userId
            },
            orderBy: {
                updatedAt: "desc"
            },
        })
        return projects;
    }),
    create: protectedProcedure.input(
        z.object({
            value: z.string()
                .min(1, "Value cannot be empty")
                .max(10000, { message: "Value is too long" }),
        })
    ).mutation(async ({ input, ctx }) => {
        console.log("Project create mutation called"); // Debug log
        console.log("User ID:", ctx.auth.userId); // Debug log

        try {
            console.log("Attempting to consume credits..."); // Debug log
            await consumeCredits();
            console.log("Credits consumed successfully"); // Debug log
        } catch (error) {
            console.error("Credit consumption failed:", error); // Debug log
            
            // Check the specific error type
            if (error instanceof Error) {
                console.error("Error message:", error.message); // Debug log
                
                // Check if it's a rate limit error from RateLimiterPrisma
                if (error.message.includes("Too Many Requests") || 
                    error.message.includes("Rate limit") ||
                    error.name === "Error" && error.message.includes("points")) {
                    throw new TRPCError({
                        code: "TOO_MANY_REQUESTS", 
                        message: "You have run out of credits"
                    });
                }
                
                // For other errors, provide more specific message
                throw new TRPCError({
                    code: "BAD_REQUEST", 
                    message: `Credit consumption failed: ${error.message}`
                });
            } else {
                console.error("Unknown error type:", typeof error, error); // Debug log
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR", 
                    message: "An unexpected error occurred"
                });
            }
        }

        console.log("Creating project..."); // Debug log

        const createdProject = await prisma.project.create({
            data: {
                userId: ctx.auth.userId,
                name: generateSlug(2, {
                    format: "kebab"
                }),
                messages: {
                    create: {
                        content: input.value,
                        role: "USER",
                        type: "RESULT"
                    }
                }
            }
        });

        console.log("Project created:", createdProject.id); // Debug log

        await inngest.send({
            name: "code-agent/run",
            data: {
                value: input.value,
                projectId: createdProject.id,
            },
        });

        console.log("Inngest event sent"); // Debug log

        return createdProject;
    })
})
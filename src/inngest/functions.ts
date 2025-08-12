import { inngest } from "./client";
import { openai, createAgent, createTool, createNetwork, type Tool } from "@inngest/agent-kit";
import { Sandbox } from "@e2b/code-interpreter";
import { getSandbox, lastAssistantTextMessageContent } from "./utils";
import { stdout } from "process";
import { ca } from "date-fns/locale";
import { z } from "zod"; // Make sure this is imported correctly
import path from "path";
import { get } from "http";
import { PROMPT } from "../prompt";
import { prisma } from "../lib/db";

interface AgentState {
    summary: string;
    files: {
        [path: string]: string;
    }
}

export const codeAgentFunction = inngest.createFunction(
    { id: "code-agent" },
    { event: "code-agent/run" },
    async ({ event, step }) => {
        const sandboxId = await step.run("get-sandbox-id", async () => {
            const sandbox = await Sandbox.create("loveable")
            return sandbox.sandboxId
        })

        const codeAgent = createAgent<AgentState>({
            name: "code-agent",
            description: "An exper coding agent",
            system: PROMPT,
            model: openai({
                model: "gpt-4o",
                defaultParameters: {
                    temperature: 0.,
                }
            }),
            tools: [
                createTool({
                    name: "terminal",
                    description: "Use the terminal to run commands in the sandbox environment.",
                    // Use Zod schema consistently like the official examples
                    parameters: z.object({
                        command: z.string().describe("The command to run in the terminal")
                    }) as any,
                    handler: async ({ command }, { step }) => {
                        return await step?.run("terminal", async () => {
                            const buffers = { stdout: "", stderr: "" };

                            try {
                                const sandbox = await getSandbox(sandboxId)
                                const result = await sandbox.commands.run(command, {
                                    onStdout: (data) => {
                                        buffers.stdout += data.toString();
                                    },
                                    onStderr: (data) => {
                                        buffers.stderr += data.toString();
                                    }
                                })
                                return result.stdout;
                            } catch (error) {
                                console.error(`Command failed: ${error} \nstdout: ${buffers.stdout}\nstderror: ${buffers.stderr}`)
                                return `Command failed: ${error} \nstdout: ${buffers.stdout}\nstderror: ${buffers.stderr}`;
                            }
                        })
                    }
                }),
                createTool({
                    name: "createOrUpdateFiles",
                    description: "Create or update files in the sandbox environment.",
                    parameters: z.object({
                        files: z.array(z.object({
                            path: z.string(),
                            content: z.string(),
                        })),
                    }),
                    handler: async (
                        { files },
                        { step, network }: Tool.Options<AgentState>
                    ) => {
                        const newFiles = await step?.run("createOrUpdateFiles", async () => {
                            try {
                                const updatedFiles = network.state.data.files || {};
                                const sandbox = await getSandbox(sandboxId);
                                for (const file of files) {
                                    await sandbox.files.write(file.path, file.content);
                                    updatedFiles[file.path] = file.content;
                                }
                                return updatedFiles;
                            } catch (error) {
                                console.error(`File operation failed: ${error}`);
                                return `File operation failed: ${error}`;
                            }
                        })

                        if (typeof newFiles === "object") {
                            network.state.data.files = newFiles;
                            console.log("Updated files state:", newFiles);
                        }
                        
                        return `Successfully created/updated ${files.length} files`;
                    }
                }),
                createTool({
                    name: "readFiles",
                    description: "Read files from the sandbox",
                    parameters: z.object({
                        files: z.array(z.string()),
                    }),
                    handler: async ({ files }, { step }) => {
                        return await step?.run("readFiles", async () => {
                            try {
                                const sandbox = await getSandbox(sandboxId);
                                const contents = [];
                                for (const file of files) {
                                    const content = await sandbox.files.read(file);
                                    contents.push({ path: file, content });
                                }
                                return JSON.stringify(contents);
                            } catch (error) {
                                return "Error: " + error;
                            }
                        })
                    }
                })
            ],
            lifecycle: {
                onResponse: async ({ result, network }) => {
                    const lastMsgContent = lastAssistantTextMessageContent(result);

                    console.log("Last assistant message:", lastMsgContent);

                    if (lastMsgContent && network) {
                        if (lastMsgContent.includes("<task_summary")) {
                            network.state.data.summary = lastMsgContent;
                            console.log("Set summary:", lastMsgContent);
                        }
                    }

                    return result;
                }
            }
        });

        const network = createNetwork<AgentState>({
            name: "coding-agent-network",
            agents: [codeAgent],
            maxIter: 15, // how many loops the agent can do
            router: async ({ network }) => {
                const summary = network.state.data.summary;
                console.log("Router check - summary:", summary);
                if (summary) {
                    console.log("Router stopping - summary found");
                    return;
                }

                console.log("Router continuing - no summary yet");
                return codeAgent;
            }
        })

        // Initialize the network state
        network.state.data = {
            summary: "",
            files: {}
        };

        // Run the agent with an input.  this automatically uses steps
        // to call your AI model.
        const result = await network.run(event.data.value);

        console.log("Agent result:", {
            summary: result.state.data.summary,
            files: result.state.data.files,
            filesCount: Object.keys(result.state.data.files || {}).length
        });

        const isError = !result.state.data.summary || Object.keys(result.state.data.files || {}).length === 0;

        const sandboxUrl = await step.run("get-sandbox-url", async () => {
            const sandbox = await getSandbox(sandboxId);
            const host = sandbox.getHost(3000)
            return `http://${host}`;
        })

        // saving the result to the database
        await step.run("save-result", async () => {
            if (isError) {
                return await prisma.message.create({
                    data: {
                        projectId: event.data.projectId,
                        content: "Something went wrong, pls. try again.",
                        role: "ASSISTANT",
                        type: "RESULT",
                    }
                })
            }
            return await prisma.message.create({
                data: {
                    projectId: event.data.projectId,
                    content: result.state.data.summary || "No summary provided",
                    role: "ASSISTANT",
                    type: "RESULT",
                    fragment: {
                        create: {
                            sandboxUrl: sandboxUrl,
                            title: "Fragment",
                            files: result.state.data.files,
                        }
                    }
                }
            })
        })

        const finalResult = {
            url: sandboxUrl,
            title: "Fragment",
            files: result.state.data.files,
            summary: result.state.data.summary
        };
        
        console.log("Final result:", finalResult);
        
        return finalResult;
    },
);